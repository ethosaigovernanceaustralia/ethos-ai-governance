// ─── Ethos — Recovery Email Unsubscribe ──────────────────────────────────────
// Unsubscribe link in the abandoned-checkout recovery email. The signed token
// (see unsubscribeToken below) stops the link being used to suppress arbitrary
// addresses.
//   GET  shows a confirmation button and changes nothing, so mail-link scanners
//        that open links automatically cannot unsubscribe anyone.
//   POST records the suppression. Mail apps send it directly for one-click
//        unsubscribe (RFC 8058, List-Unsubscribe-Post); the button posts here too.
// Tokens are signed with UNSUBSCRIBE_SECRET. Links sent before that secret
// existed were signed with SUPABASE_SECRET_KEY and are still accepted, so every
// unsubscribe link already in an inbox keeps working.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { escapeHtml } = require('../../lib/html');
const { missingEnvironment } = require('../../lib/environment');
const { createClient } = require('@supabase/supabase-js');

function sign(secret, email) {
  return crypto
    .createHmac('sha256', secret)
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function signingSecret() {
  const dedicated = (process.env.UNSUBSCRIBE_SECRET || '').trim();
  return dedicated || process.env.SUPABASE_SECRET_KEY;
}

function unsubscribeToken(email) {
  return sign(signingSecret(), email);
}

function tokenMatches(email, token) {
  const secrets = [(process.env.UNSUBSCRIBE_SECRET || '').trim(), process.env.SUPABASE_SECRET_KEY].filter(Boolean);
  const provided = Buffer.from(token);
  return secrets.some(secret => {
    const expected = Buffer.from(sign(secret, email));
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  });
}

function page(message, form = '') {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex"/>
<title>Unsubscribe | Ethos AI Governance</title></head>
<body style="font-family:sans-serif;background:#F8F7F5;margin:0;padding:48px 24px;color:#0D1F3C">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:32px;text-align:center">
    <div style="font-size:16px;font-weight:700;letter-spacing:0.05em">ETHOS</div>
    <p style="font-size:14px;color:#374151;margin-top:20px">${escapeHtml(message)}</p>${form}
  </div>
</body></html>`;
}

function send(res, code, html) {
  // The URL carries the address and token: keep it out of caches and referrers.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(code).send(html);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The address and token always come from the link itself, for both methods.
  const { email, token } = req.query || {};
  if (typeof email !== 'string' || Buffer.byteLength(email, 'utf8') > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
    return send(res, 400, page('This unsubscribe link is missing information and could not be processed.'));
  }

  if (missingEnvironment(['SUPABASE_URL', 'SUPABASE_SECRET_KEY']).length) {
    return send(res, 503, page('Unsubscribe is temporarily unavailable. Please contact mike@ethosaigovernance.com.au.'));
  }

  if (!tokenMatches(email, token)) {
    return send(res, 400, page('This unsubscribe link is invalid or has expired.'));
  }

  if (req.method === 'GET') {
    const action = `/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
    const form = `
    <form method="post" action="${escapeHtml(action)}" style="margin-top:24px">
      <button type="submit" style="background:#0D1F3C;color:#ffffff;border:0;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:600;cursor:pointer">Unsubscribe</button>
    </form>`;
    return send(res, 200, page('Stop receiving checkout reminder emails at this address?', form));
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
    return send(res, 500, page('Something went wrong processing your request. Please email mike@ethosaigovernance.com.au and we will remove you manually.'));
  }

  return send(res, 200, page('You have been unsubscribed and will not receive further checkout reminder emails.'));
};

module.exports.unsubscribeToken = unsubscribeToken;
