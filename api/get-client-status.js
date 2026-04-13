// ─── Ethos — Get Client Login Status ─────────────────────────────────────────
// Vercel serverless function. Admin-only.
// Returns whether a client has ever logged in (used to show/hide Resend Invite).
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { clientId } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'Missing required field: clientId' });
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

  // Look up the auth user to check last_sign_in_at
  const { data: { user }, error } = await supabase.auth.admin.getUserById(clientId);

  if (error || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.status(200).json({
    hasLoggedIn: user.last_sign_in_at !== null,
  });
};
