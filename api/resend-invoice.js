// ─── Ethos — Resend Invoice ───────────────────────────────────────────────────
// Vercel serverless function. Admin-only.
// Re-sends an existing invoice PDF to the client's email.
// Updates last_emailed_at and increments email_count on the invoice row.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { invoiceId } = req.body;
  if (!invoiceId) {
    return res.status(400).json({ error: 'Missing required field: invoiceId' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify the caller is a logged-in admin
  const bearerToken = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!bearerToken) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user: callerUser }, error: tokenError } = await supabase.auth.getUser(bearerToken);
  if (tokenError || !callerUser) return res.status(401).json({ error: 'Unauthorized' });

  const { data: callerProfile } = await supabase
    .from('profiles').select('role').eq('id', callerUser.id).single();
  if (!callerProfile || callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Fetch invoice with client profile
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*, profiles(full_name, email)')
    .eq('id', invoiceId)
    .single();

  if (invoiceError || !invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  if (!invoice.file_path) {
    return res.status(400).json({ error: 'Invoice PDF has not been generated yet' });
  }

  // Download PDF from ethos-assets storage using a short-lived signed URL
  const { data: signedData, error: signedError } = await supabase.storage
    .from('ethos-assets')
    .createSignedUrl(invoice.file_path, 60);

  if (signedError) {
    return res.status(500).json({ error: 'Could not access invoice PDF from storage' });
  }

  const pdfResponse = await fetch(signedData.signedUrl);
  if (!pdfResponse.ok) {
    return res.status(500).json({ error: 'Failed to download invoice PDF' });
  }
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());

  // Send email via Resend
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const PRODUCT_NAMES = {
    au_compliance_core: 'AU Compliance Core',
    full_toolkit:       'Full Responsible AI Toolkit',
  };
  const productName = PRODUCT_NAMES[invoice.product_tier] || invoice.product_tier;
  const clientEmail = invoice.profiles.email;
  const clientName  = invoice.profiles.full_name;
  const firstName   = clientName.split(' ')[0] || clientName;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#0D1F3C;padding:24px 32px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.05em">ETHOS</div>
        <div style="font-size:11px;color:#C9A84C;margin-top:3px">AI Governance</div>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <p style="font-size:15px;color:#111827;margin-top:0">Hi ${firstName},</p>
        <p style="font-size:15px;color:#111827">
          Please find attached your invoice for <strong>${productName}</strong>.
        </p>
        <p style="font-size:14px;color:#374151">
          If you have any questions, contact us at
          <a href="mailto:hello@ethosaigovernance.com.au" style="color:#C9A84C">hello@ethosaigovernance.com.au</a>.
        </p>
        <p style="font-size:14px;color:#374151;margin-bottom:0">— The Ethos Team</p>
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px">
        Ethos AI Governance · ethosaigovernance.com.au
      </p>
    </div>
  `;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Ethos AI Governance <hello@ethosaigovernance.com.au>',
      to:      [clientEmail],
      subject: `Your invoice from Ethos AI Governance — ${invoice.invoice_number}`,
      html,
      attachments: [{
        filename: `${invoice.invoice_number}.pdf`,
        content:  pdfBytes.toString('base64'),
      }],
    }),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    return res.status(500).json({ error: `Email failed: ${errText}` });
  }

  // Update tracking fields
  await supabase.from('invoices').update({
    last_emailed_at: new Date().toISOString(),
    email_count:     (invoice.email_count || 0) + 1,
  }).eq('id', invoiceId);

  return res.status(200).json({ success: true });
};
