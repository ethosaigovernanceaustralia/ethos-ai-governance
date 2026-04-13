// ─── Ethos — Stripe Webhook Handler ──────────────────────────────────────────
// Vercel serverless function. Handles post-payment automation.
//
// checkout.session.completed:
//   1. Idempotency check          (critical — returns 500 if fails, Stripe retries)
//   2. Find or create client      (critical)
//   3. Grant product access       (critical)
//   4. Create engagement          (non-critical — logged if fails)
//   5. Generate invoice PDF       (non-critical)
//   6. Upload PDF to storage      (non-critical)
//   7. Insert invoice record      (non-critical)
//   8. Send invoice email         (non-critical)
//   9. Mark abandoned checkout recovered (non-critical)
//
// checkout.session.expired:
//   Records the abandoned checkout for Stage 3 recovery emails.
// ─────────────────────────────────────────────────────────────────────────────

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Disable Vercel's body parser — Stripe needs the raw body to verify the signature
async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Verify Stripe signature using raw body
  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], webhookSecret);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Route to handler
  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object);
    } else if (event.type === 'checkout.session.expired') {
      await handleCheckoutExpired(event.data.object);
    }
  } catch (err) {
    // Critical step failed — return 500 so Stripe retries
    console.error(`[webhook] Critical error handling ${event.type}:`, err);
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).json({ received: true });
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;


// ─── checkout.session.completed ───────────────────────────────────────────────

async function handleCheckoutCompleted(session) {
  const supabase = getSupabase();
  const email       = session.customer_details?.email;
  const name        = session.customer_details?.name || email;
  const productTier = session.metadata?.product_tier;
  const sessionId   = session.id;

  if (!email || !productTier) {
    throw new Error(`Session ${sessionId} is missing email or product_tier metadata`);
  }

  // ── Critical steps (throw on failure — Stripe will retry) ─────────────────

  // 1. Idempotency: skip if already processed
  const { data: existing } = await supabase
    .from('product_access')
    .select('id')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (existing) {
    console.log(`[webhook] Session ${sessionId} already processed — skipping`);
    return;
  }

  // 2. Find or create client
  const { clientId } = await findOrCreateClient(supabase, email, name);

  // 3. Grant product access
  const { error: accessError } = await supabase.from('product_access').insert({
    client_id:         clientId,
    product_tier:      productTier,
    stripe_session_id: sessionId,
  });
  if (accessError) throw accessError;

  console.log(`[webhook] Access granted: ${email} → ${productTier}`);

  // ── Non-critical steps (log on failure — still return 200) ────────────────

  await tryStep('create-engagement', () =>
    supabase.from('engagements').insert({
      client_id:       clientId,
      engagement_type: productTier,
      status:          'active',
    }).then(({ error }) => { if (error) throw error; })
  );

  await tryStep('invoice', () =>
    generateAndSendInvoice(supabase, { clientId, email, name, productTier, sessionId })
  );

  await tryStep('abandoned-checkout-recovery', () =>
    supabase
      .from('abandoned_checkouts')
      .update({ completed_at: new Date().toISOString() })
      .eq('customer_email', email)
      .eq('product_tier', productTier)
      .is('completed_at', null)
      .then(({ error }) => { if (error) throw error; })
  );
}


// ─── checkout.session.expired ─────────────────────────────────────────────────

async function handleCheckoutExpired(session) {
  const supabase    = getSupabase();
  const email       = session.customer_details?.email || null;
  const productTier = session.metadata?.product_tier;

  if (!productTier) return; // Can't record without knowing what product was attempted

  try {
    await supabase.from('abandoned_checkouts').insert({
      stripe_session_id: session.id,
      customer_email:    email,
      product_tier:      productTier,
    });
  } catch (err) {
    // Likely a duplicate stripe_session_id — safe to ignore
    console.log('[webhook] Abandoned checkout insert skipped (likely duplicate):', err.message);
  }
}


// ─── Find or create client ────────────────────────────────────────────────────

async function findOrCreateClient(supabase, email, name) {
  // Check for existing profile by email
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    console.log(`[webhook] Existing client found: ${email}`);
    return { clientId: existing.id, isNewClient: false };
  }

  // New client — invite via Supabase Auth (same method as invite-client.js)
  // Supabase sends the invite email automatically
  const { data: userData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name },
    redirectTo: 'https://ethosaigovernance.com.au/portal/reset-password',
  });
  if (inviteError) throw inviteError;

  const clientId = userData.user.id;

  const { error: profileError } = await supabase.from('profiles').insert({
    id:           clientId,
    full_name:    name,
    email:        email,
    company_name: null,  // Stripe doesn't collect company name — fill in via admin portal
    role:         'client',
  });
  if (profileError) throw profileError;

  console.log(`[webhook] New client created and invited: ${email}`);
  return { clientId, isNewClient: true };
}


// ─── Invoice generation ───────────────────────────────────────────────────────

const PRODUCT_NAMES = {
  au_compliance_core: 'AU Compliance Core',
  full_toolkit:       'Full Responsible AI Toolkit',
};
const PRODUCT_AMOUNTS = {
  au_compliance_core: 999.00,
  full_toolkit:       1699.00,
};

async function generateAndSendInvoice(supabase, { clientId, email, name, productTier, sessionId }) {
  const productName = PRODUCT_NAMES[productTier];
  const amount      = PRODUCT_AMOUNTS[productTier];
  const invoiceDate = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Insert invoice row — invoice_number is auto-assigned by the DB sequence (ETH-24050, 24051…)
  const { data: invoiceRow, error: insertError } = await supabase
    .from('invoices')
    .insert({
      client_id:        clientId,
      product_tier:     productTier,
      amount_aud_cents: Math.round(amount * 100),
      stripe_session_id: sessionId,
    })
    .select('id, invoice_number')
    .single();
  if (insertError) throw insertError;

  const { id: invoiceId, invoice_number: invoiceNumber } = invoiceRow;

  // Generate PDF
  const pdfBytes = await buildInvoicePDF({ invoiceNumber, invoiceDate, clientName: name, clientEmail: email, productName, amount });

  // Upload PDF to ethos-assets storage
  const pdfPath = `invoices/${invoiceNumber}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('ethos-assets')
    .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw uploadError;

  // Record file path on the invoice row
  await supabase.from('invoices').update({ file_path: pdfPath }).eq('id', invoiceId);

  // Send email with PDF attached (Resend, matching notify-enquiry.js pattern)
  await sendInvoiceEmail({ email, name, invoiceNumber, productName, pdfBytes });
}


// ─── PDF builder ──────────────────────────────────────────────────────────────

async function buildInvoicePDF({ invoiceNumber, invoiceDate, clientName, clientEmail, productName, amount }) {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  const navyColor    = rgb(0.051, 0.122, 0.271);
  const goldColor    = rgb(0.788, 0.659, 0.298);
  const mutedColor   = rgb(0.42,  0.42,  0.42);
  const ruleColor    = rgb(0.88,  0.88,  0.88);
  const headerColor  = rgb(0.94,  0.94,  0.94);
  const blackColor   = rgb(0.08,  0.08,  0.08);
  const whiteColor   = rgb(1,     1,     1);

  // ── Navy header bar ──
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: navyColor });
  page.drawText('ETHOS',        { x: 48, y: height - 37, size: 20, font: bold,    color: whiteColor });
  page.drawText('AI Governance',{ x: 48, y: height - 55, size: 9,  font: regular, color: goldColor });

  const invoiceLabel      = 'INVOICE';
  const invoiceLabelWidth = bold.widthOfTextAtSize(invoiceLabel, 22);
  page.drawText(invoiceLabel, { x: width - 48 - invoiceLabelWidth, y: height - 48, size: 22, font: bold, color: whiteColor });

  // ── Invoice meta ──
  let y = height - 108;
  page.drawText(`Invoice Number:  ${invoiceNumber}`, { x: 48, y,      size: 10, font: bold,    color: navyColor });
  page.drawText(`Date:  ${invoiceDate}`,             { x: 48, y: y - 17, size: 10, font: regular, color: blackColor });

  // ── From / To ──
  y = height - 175;
  page.drawText('FROM', { x: 48,  y, size: 7, font: bold, color: mutedColor });
  page.drawText('TO',   { x: 300, y, size: 7, font: bold, color: mutedColor });

  y -= 14;
  page.drawText('Ethos AI Governance', { x: 48,  y, size: 10, font: bold,    color: blackColor });
  page.drawText(clientName,            { x: 300, y, size: 10, font: bold,    color: blackColor });

  y -= 16;
  page.drawText('ABN 49 548 860 916',            { x: 48,  y, size: 9, font: regular, color: blackColor });
  page.drawText(clientEmail,                     { x: 300, y, size: 9, font: regular, color: blackColor });

  y -= 14;
  page.drawText('Mike@ethosaigovernance.com.au', { x: 48, y, size: 9, font: regular, color: blackColor });

  // ── Divider ──
  y -= 30;
  page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 0.75, color: ruleColor });

  // ── Table header ──
  y -= 22;
  page.drawRectangle({ x: 48, y: y - 7, width: width - 96, height: 24, color: headerColor });
  page.drawText('DESCRIPTION',  { x: 56,           y, size: 8, font: bold, color: mutedColor });
  page.drawText('QTY',          { x: 390,           y, size: 8, font: bold, color: mutedColor });
  page.drawText('AMOUNT (AUD)', { x: width - 130,   y, size: 8, font: bold, color: mutedColor });

  // ── Line item ──
  y -= 32;
  page.drawText(productName,           { x: 56,         y, size: 10, font: regular, color: blackColor });
  page.drawText('1',                   { x: 395,         y, size: 10, font: regular, color: blackColor });
  page.drawText(`$${amount.toFixed(2)}`, { x: width - 115, y, size: 10, font: regular, color: blackColor });

  // ── Divider before total ──
  y -= 22;
  page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 0.75, color: ruleColor });

  // ── Total ──
  y -= 22;
  page.drawText('TOTAL', { x: 390, y, size: 10, font: bold, color: blackColor });
  page.drawText(`$${amount.toFixed(2)}`, { x: width - 115, y, size: 11, font: bold, color: navyColor });

  y -= 16;
  page.drawText('Payment received via card', { x: 390, y, size: 8, font: regular, color: mutedColor });

  // ── Footer ──
  page.drawLine({ start: { x: 48, y: 58 }, end: { x: width - 48, y: 58 }, thickness: 0.75, color: ruleColor });
  page.drawText('Ethos AI Governance provides AI governance consulting services.', {
    x: 48, y: 40, size: 8, font: regular, color: mutedColor,
  });

  return await doc.save();
}


// ─── Invoice email ────────────────────────────────────────────────────────────

async function sendInvoiceEmail({ email, name, invoiceNumber, productName, pdfBytes }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');

  const firstName = name.split(' ')[0] || name;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#0D1F3C;padding:24px 32px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.05em">ETHOS</div>
        <div style="font-size:11px;color:#C9A84C;margin-top:3px">AI Governance</div>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <p style="font-size:15px;color:#111827;margin-top:0">Hi ${firstName},</p>
        <p style="font-size:15px;color:#111827">
          Thank you for purchasing <strong>${productName}</strong>.
          Your invoice is attached to this email.
        </p>
        <p style="font-size:14px;color:#374151">
          You will receive a separate email shortly with a link to set up your Ethos client portal.
          Once you log in, your ${productName} documents will be ready to download.
        </p>
        <p style="font-size:14px;color:#374151">
          If you have any questions, contact us at
          <a href="mailto:Mike@ethosaigovernance.com.au" style="color:#C9A84C">Mike@ethosaigovernance.com.au</a>.
        </p>
        <p style="font-size:14px;color:#374151;margin-bottom:0">— The Ethos Team</p>
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px">
        Ethos AI Governance · ethosaigovernance.com.au
      </p>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Ethos AI Governance <hello@ethosaigovernance.com.au>',
      to:      [email],
      subject: `Your invoice from Ethos AI Governance — ${invoiceNumber}`,
      html,
      attachments: [{
        filename: `${invoiceNumber}.pdf`,
        content:  Buffer.from(pdfBytes).toString('base64'),
      }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Resend error: ${errText}`);
  }
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function tryStep(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[webhook] Non-critical step "${name}" failed:`, err.message);
  }
}
