// ─── Ethos — Resend Invite ────────────────────────────────────────────────────
// Vercel serverless function. Admin-only.
// Sends a fresh set-password link (through Resend) to a client whose original link expired.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const { createSetPasswordLink, sendSetPasswordEmail } = require('../../lib/auth-links');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Missing required field: email' });
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

  // Fresh set-password link for the existing login, sent as Ethos-branded email.
  const emailNorm = String(email).trim().toLowerCase();
  const { data: client } = await supabase.from('profiles').select('full_name').eq('email', emailNorm).maybeSingle();
  const { link, error } = await createSetPasswordLink(supabase, { type: 'recovery', email: emailNorm });
  if (error) {
    console.error('Resend invite error:', error.code || error.message);
    return res.status(500).json({ error: error.message });
  }
  try {
    await sendSetPasswordEmail({ email: emailNorm, name: client?.full_name, purpose: 'portal_invite', link });
  } catch (err) {
    console.error('Resend invite email error:', err.message);
    return res.status(500).json({ error: 'Failed to send email' });
  }

  return res.status(200).json({ success: true, message: `Invite resent to ${email}` });
};
