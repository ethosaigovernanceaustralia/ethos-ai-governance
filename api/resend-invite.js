// ─── Ethos — Resend Invite ────────────────────────────────────────────────────
// Vercel serverless function. Admin-only.
// Sends a fresh Supabase invite email to a client whose original link expired.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

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

  // Send a fresh invite — Supabase handles the email
  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: 'https://ethosaigovernance.com.au/portal/reset-password',
  });

  if (error) {
    console.error('Resend invite error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, message: `Invite resent to ${email}` });
};
