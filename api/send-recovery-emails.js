// ─── Ethos — Abandoned Checkout Recovery Emails ──────────────────────────────
// Vercel Cron Job. Called daily at 1am UTC (11am AEST).
// Sends one recovery email per abandoned checkout that:
//   - Has an email address
//   - Has not already received a recovery email
//   - Has not been completed (recovered)
//   - Was abandoned more than 24 hours ago
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify the Vercel cron secret (set CRON_SECRET in Vercel env vars)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('[recovery] RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Find qualifying abandoned checkouts (abandoned > 24h ago, not yet emailed, not recovered)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: checkouts, error } = await supabase
    .from('abandoned_checkouts')
    .select('*')
    .not('customer_email', 'is', null)
    .is('recovery_email_sent_at', null)
    .is('completed_at', null)
    .lt('abandoned_at', cutoff);

  if (error) {
    console.error('[recovery] Query failed:', error.message);
    return res.status(500).json({ error: error.message });
  }

  if (!checkouts?.length) {
    console.log('[recovery] No qualifying abandoned checkouts — nothing to send');
    return res.status(200).json({ sent: 0 });
  }

  console.log(`[recovery] Found ${checkouts.length} abandoned checkout(s) to email`);

  const PRODUCT_NAMES = {
    au_compliance_core: 'AU Compliance Core',
    full_toolkit:       'Full Responsible AI Toolkit',
  };

  let sentCount = 0;

  for (const checkout of checkouts) {
    const productName = PRODUCT_NAMES[checkout.product_tier] || checkout.product_tier;

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#0D1F3C;padding:24px 32px;border-radius:8px 8px 0 0">
          <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.05em">ETHOS</div>
          <div style="font-size:11px;color:#C9A84C;margin-top:3px">AI Governance</div>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
          <p style="font-size:15px;color:#111827;margin-top:0">Hi,</p>
          <p style="font-size:15px;color:#111827">
            You started setting up your AI governance framework with our
            <strong>${productName}</strong> but didn't complete checkout.
          </p>
          <p style="font-size:14px;color:#374151">
            Your governance documents are ready whenever you are.
          </p>
          <p style="margin:28px 0">
            <a href="https://ethosaigovernance.com.au/#services"
               style="background:#0D1F3C;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">
              Continue to checkout
            </a>
          </p>
          <p style="font-size:14px;color:#374151">
            If you had any questions before purchasing, just reply to this email — I'm happy to help.
          </p>
          <p style="font-size:14px;color:#374151;margin-bottom:0">— Mike, Ethos AI Governance</p>
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
        to:      [checkout.customer_email],
        subject: 'Your AI governance documents are ready whenever you are',
        html,
      }),
    });

    if (emailRes.ok) {
      await supabase
        .from('abandoned_checkouts')
        .update({ recovery_email_sent_at: new Date().toISOString() })
        .eq('id', checkout.id);

      sentCount++;
      console.log(`[recovery] Sent recovery email to: ${checkout.customer_email}`);
    } else {
      const errText = await emailRes.text();
      console.error(`[recovery] Failed to send to ${checkout.customer_email}:`, errText);
    }
  }

  console.log(`[recovery] Done. Sent ${sentCount} of ${checkouts.length} emails.`);
  return res.status(200).json({ sent: sentCount, total: checkouts.length });
};
