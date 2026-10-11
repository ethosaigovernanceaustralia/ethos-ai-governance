// ─── Ethos — Invite Client API Route ─────────────────────────────────────
// Vercel serverless function. Runs server-side only.
// Uses the service role key to create a Supabase user and send an invitation.
// The service role key is NEVER exposed to the browser.
// ─────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const { createSetPasswordLink, sendSetPasswordEmail } = require('../../lib/auth-links');

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

  // Create the login and its set-password link; the email is sent once the profile exists.
  const emailNorm = String(email).trim().toLowerCase();
  const { user: invitedUser, link, error: inviteError } = await createSetPasswordLink(supabase, {
    type: 'invite', email: emailNorm, data: { full_name: fullName, company_name: companyName },
  });

  if (inviteError) {
    console.error('Invite error:', inviteError.code || inviteError.message);
    return res.status(500).json({ error: 'The client could not be invited. Please check the email address and try again.' });
  }

  const userId = invitedUser.id;

  // Create the profile row
  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    full_name: fullName,
    company_name: companyName,
    email: emailNorm,
    role: 'client'
  });

  if (profileError) {
    console.error('Profile error:', profileError.code || 'unknown');
    return res.status(500).json({ error: 'The client profile could not be created. Please try again.' });
  }

  // Create the engagement if a type was specified
  if (engagementType) {
    const { error: engError } = await supabase.from('engagements').insert({
      client_id: userId,
      engagement_type: engagementType,
      status: 'active'
    });

    if (engError) {
      console.error('Engagement error:', engError.code || 'unknown');
      // Non-fatal — profile was created, engagement can be added manually
    }
  }

  try {
    await sendSetPasswordEmail({ email: emailNorm, name: fullName, purpose: 'portal_invite', link });
  } catch (err) {
    console.error('Invite email error:', err.message);
    return res.status(200).json({ success: true, userId, message: `Client created, but the invitation email failed. Use Resend invite for ${emailNorm}.` });
  }

  return res.status(200).json({
    success: true,
    userId,
    message: `Invitation sent to ${emailNorm}`
  });
};
