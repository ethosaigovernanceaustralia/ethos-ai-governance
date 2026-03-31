// ─── Ethos — Invite Client API Route ─────────────────────────────────────
// Vercel serverless function. Runs server-side only.
// Uses the service role key to create a Supabase user and send an invitation.
// The service role key is NEVER exposed to the browser.
// ─────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fullName, email, companyName, engagementType } = req.body;

  if (!fullName || !email || !companyName) {
    return res.status(400).json({ error: 'Missing required fields: fullName, email, companyName' });
  }

  // Build admin Supabase client using the service role key
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify the caller is a logged-in admin by checking their session token
  const bearerToken = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!bearerToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { data: { user: callerUser }, error: tokenError } = await supabase.auth.getUser(bearerToken);
  if (tokenError || !callerUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { data: callerProfile } = await supabase.from('profiles').select('role').eq('id', callerUser.id).single();
  if (!callerProfile || callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Invite user — Supabase sends the invitation email automatically
  const { data: userData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, company_name: companyName },
    redirectTo: 'https://ethosaigovernance.com.au/portal/reset-password',
  });

  if (inviteError) {
    console.error('Invite error:', inviteError);
    return res.status(500).json({ error: inviteError.message });
  }

  const userId = userData.user.id;

  // Create the profile row
  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    full_name: fullName,
    company_name: companyName,
    email: email,
    role: 'client'
  });

  if (profileError) {
    console.error('Profile error:', profileError);
    return res.status(500).json({ error: profileError.message });
  }

  // Create the engagement if a type was specified
  if (engagementType) {
    const { error: engError } = await supabase.from('engagements').insert({
      client_id: userId,
      engagement_type: engagementType,
      status: 'active'
    });

    if (engError) {
      console.error('Engagement error:', engError);
      // Non-fatal — profile was created, engagement can be added manually
    }
  }

  return res.status(200).json({
    success: true,
    userId,
    message: `Invitation sent to ${email}`
  });
};
