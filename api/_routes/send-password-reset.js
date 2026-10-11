// ─── Ethos — Send Password Reset Email ───────────────────────────────────────
// Vercel serverless function. Admin-only.
// Generates a Supabase password recovery link and sends a branded email via
// Resend. Used when an admin needs to trigger a password reset for a client.
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

  // Generate a password recovery link for the client
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: 'https://ethosaigovernance.com.au/portal/reset-password',
    },
  });

  if (linkError) {
    console.error('[password-reset] Generate link error:', linkError);
    return res.status(500).json({ error: linkError.message });
  }

  const resetLink = linkData.properties?.action_link;
  if (!resetLink) {
    return res.status(500).json({ error: 'Could not generate reset link' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#0D1F3C;padding:24px 32px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.05em">ETHOS</div>
        <div style="font-size:11px;color:#C9A84C;margin-top:3px">AI Governance</div>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <p style="font-size:15px;color:#111827;margin-top:0">Hi,</p>
        <p style="font-size:15px;color:#111827">
          You've been sent a link to reset your Ethos AI Governance portal password.
        </p>
        <p style="font-size:14px;color:#374151">
          Click the button below to choose a new password. This link will expire in 24 hours.
        </p>
        <p style="margin:28px 0">
          <a href="${resetLink}"
             style="background:#0D1F3C;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">
            Reset your password
          </a>
        </p>
        <p style="font-size:13px;color:#6b7280">
          If you didn't request this, you can safely ignore this email — your password won't change.
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
      to:      [email],
      subject: 'Reset your Ethos portal password',
      html,
    }),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error('[password-reset] Resend error:', errText);
    return res.status(500).json({ error: 'Failed to send email' });
  }

  console.log(`[password-reset] Sent password reset to: ${email}`);
  return res.status(200).json({ success: true });
};
