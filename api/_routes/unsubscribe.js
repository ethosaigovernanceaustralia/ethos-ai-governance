// ─── Ethos — Recovery Email Unsubscribe ──────────────────────────────────────
// Landing page for the unsubscribe link in the abandoned-checkout recovery
// email. Verifies the signed token (see makeUnsubscribeToken in
// send-recovery-emails.js) so the link can't be used to suppress arbitrary
// addresses, then adds the email to email_suppressions permanently.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { escapeHtml } = require('../../lib/html');
const { missingEnvironment } = require('../../lib/environment');
const { createClient } = require('@supabase/supabase-js');

function unsubscribeToken(email) {
  return crypto
    .createHmac('sha256', process.env.SUPABASE_SECRET_KEY)
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function page(message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Unsubscribe | Ethos AI Governance</title></head>
<body style="font-family:sans-serif;background:#F8F7F5;margin:0;padding:48px 24px;color:#0D1F3C">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:32px;text-align:center">
    <div style="font-size:16px;font-weight:700;letter-spacing:0.05em">ETHOS</div>
    <p style="font-size:14px;color:#374151;margin-top:20px">${escapeHtml(message)}</p>
  </div>
</body></html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, token } = req.query || {};
  if (typeof email !== 'string' || Buffer.byteLength(email, 'utf8') > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
    return res.status(400).send(page('This unsubscribe link is missing information and could not be processed.'));
  }

  if (missingEnvironment(['SUPABASE_URL', 'SUPABASE_SECRET_KEY']).length) {
    return res.status(503).send(page('Unsubscribe is temporarily unavailable. Please contact hello@ethosaigovernance.com.au.'));
  }

  const expected = unsubscribeToken(email);
  const provided = String(token);
  const valid =
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));

  if (!valid) {
    return res.status(400).send(page('This unsubscribe link is invalid or has expired.'));
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await supabase
    .from('email_suppressions')
    .upsert({ email: email.trim().toLowerCase(), source: 'checkout_recovery' }, { onConflict: 'email' });

  if (error) {
    console.error('[unsubscribe] Failed to record suppression:', error.message);
    return res.status(500).send(page('Something went wrong processing your request. Please email hello@ethosaigovernance.com.au and we will remove you manually.'));
  }

  return res.status(200).send(page(`${email} has been unsubscribed and will not receive further checkout reminder emails.`));
};

module.exports.unsubscribeToken = unsubscribeToken;
