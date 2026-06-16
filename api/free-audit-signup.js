const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const CONSENT_VERSION = '1.0';

const CONSENT_TEXT = {
  terms_of_service: 'I agree to the Portal Terms of Service',
  privacy_policy: 'I agree to the Privacy Policy',
  app8_overseas_disclosure:
    'I expressly consent to my information being disclosed to overseas service providers (Supabase, USA; Resend, USA), and I acknowledge that APP 8.1 (reasonable steps) will not apply and that I may not be able to seek redress under the Privacy Act if an overseas recipient mishandles my information',
};

function escapeHtml(v = '') {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, company, email, password, consents, _hp } = req.body || {};

  // Honeypot: populated means bot — silently succeed
  if (_hp !== '') return res.status(200).json({ success: true });

  // Validate presence and types
  if (
    !name || typeof name !== 'string' ||
    !company || typeof company !== 'string' ||
    !email || typeof email !== 'string' ||
    !password || typeof password !== 'string'
  ) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (name.trim().length > 100)    return res.status(400).json({ error: 'Name too long' });
  if (company.trim().length > 100) return res.status(400).json({ error: 'Company too long' });

  const emailNorm = email.trim().toLowerCase();
  if (emailNorm.length > 254) return res.status(400).json({ error: 'Email too long' });
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be 8–72 characters' });
  }

  if (
    consents?.terms !== true ||
    consents?.privacy !== true ||
    consents?.app8 !== true
  ) {
    return res.status(400).json({ error: 'Consent required' });
  }

  const supabase = getSupabase();

  // 1. Create auth user (auto-confirmed — user is present, 3 slots/month, admin reviews all)
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: emailNorm,
    password,
    user_metadata: { full_name: name.trim(), company_name: company.trim() },
    email_confirm: true,
  });

  if (authError) {
    if (authError.message && authError.message.toLowerCase().includes('already registered')) {
      return res.status(200).json({ error: 'duplicate' });
    }
    console.error('[free-audit-signup] createUser error:', authError);
    return res.status(500).json({ error: 'Account creation failed' });
  }

  const userId = authData.user.id;

  async function rollback() {
    const { error: delError } = await supabase.auth.admin.deleteUser(userId);
    if (delError) {
      console.error('[CRITICAL] Orphaned auth user:', userId, emailNorm, delError);
    }
  }

  // 2. Insert profile
  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    full_name: name.trim(),
    company_name: company.trim(),
    email: emailNorm,
    role: 'client',
  });

  if (profileError) {
    console.error('[free-audit-signup] profile insert error:', profileError);
    await rollback();
    return res.status(500).json({ error: 'Setup failed' });
  }

  // 3. Insert consent records
  const userAgent = req.headers['user-agent'] || null;
  const now = new Date().toISOString();

  const { error: consentError } = await supabase.from('consents').insert([
    {
      user_id: userId,
      consent_type: 'terms_of_service',
      consent_text: CONSENT_TEXT.terms_of_service,
      consented_at: now,
      user_agent: userAgent,
      version: CONSENT_VERSION,
    },
    {
      user_id: userId,
      consent_type: 'privacy_policy',
      consent_text: CONSENT_TEXT.privacy_policy,
      consented_at: now,
      user_agent: userAgent,
      version: CONSENT_VERSION,
    },
    {
      user_id: userId,
      consent_type: 'app8_overseas_disclosure',
      consent_text: CONSENT_TEXT.app8_overseas_disclosure,
      consented_at: now,
      user_agent: userAgent,
      version: CONSENT_VERSION,
    },
  ]);

  if (consentError) {
    console.error('[free-audit-signup] consent insert error:', consentError);
    await rollback();
    return res.status(500).json({ error: 'Setup failed' });
  }

  // 4. Insert pending engagement
  const { error: engError } = await supabase.from('engagements').insert({
    client_id: userId,
    engagement_type: 'free_audit',
    status: 'pending',
  });

  if (engError) {
    console.error('[free-audit-signup] engagement insert error:', engError);
    await rollback();
    return res.status(500).json({ error: 'Setup failed' });
  }

  // 5. Admin notification — best-effort, non-fatal
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Ethos Portal <noreply@ethosaigovernance.com.au>',
      to: process.env.NOTIFY_EMAIL,
      subject: 'New free audit signup',
      html: `
        <p>A new free audit account has been created and is pending your review.</p>
        <table>
          <tr><td><strong>Name:</strong></td><td>${escapeHtml(name.trim())}</td></tr>
          <tr><td><strong>Company:</strong></td><td>${escapeHtml(company.trim())}</td></tr>
          <tr><td><strong>Email:</strong></td><td>${escapeHtml(emailNorm)}</td></tr>
        </table>
        <p><a href="https://ethosaigovernance.com.au/portal/admin">Open admin portal</a> to review and confirm their audit slot.</p>
      `,
    });
  } catch (emailErr) {
    console.error('[free-audit-signup] Resend error (non-fatal):', emailErr);
  }

  return res.status(200).json({ success: true });
};
