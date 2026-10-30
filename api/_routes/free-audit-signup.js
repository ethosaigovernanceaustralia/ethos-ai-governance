// ─── Ethos — Free Audit Sign-up ──────────────────────────────────────────────
// Creates a free-audit client without a password (security plan P3). The client
// is emailed a set-password link (lib/auth-links.js, sent through Resend), so only
// the owner of the inbox can ever sign in. The response is the
// same whether or not the email already has an account, so the form does not
// reveal who is registered.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../../lib/email');
const { escapeHtml } = require('../../lib/html');
const { missingEnvironment } = require('../../lib/environment');
const { createSetPasswordLink, sendSetPasswordEmail, isEmailExists } = require('../../lib/auth-links');
const { CONSENT_VERSION, CONSENT_TEXT } = require('./_consent-constants');

// Durable site-wide cap on new free-audit accounts, counted from saved engagements.
const SIGNUPS_PER_HOUR = 10;
const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const ACCEPTED = { success: true };

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

  const { name, company, email, consents, _hp } = req.body || {};

  // Honeypot: populated means bot — silently succeed
  if (_hp !== '') return res.status(200).json(ACCEPTED);

  if (typeof name !== 'string' || typeof company !== 'string' || typeof email !== 'string') {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const fullName = name.trim();
  const companyName = company.trim();
  const emailNorm = email.trim().toLowerCase();
  if (!fullName || fullName.length > 100 || !companyName || companyName.length > 100 ||
      emailNorm.length > 254 || !EMAIL_PATTERN.test(emailNorm)) {
    return res.status(400).json({ error: 'Invalid details' });
  }
  if (consents?.terms !== true || consents?.privacy !== true || consents?.app8 !== true) {
    return res.status(400).json({ error: 'Consent required' });
  }

  if (missingEnvironment(['SUPABASE_URL', 'SUPABASE_SECRET_KEY']).length) {
    return res.status(503).json({ error: 'Sign-up is temporarily unavailable' });
  }
  const supabase = getSupabase();

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase.from('engagements')
    .select('id', { count: 'exact', head: true })
    .eq('engagement_type', 'free_audit').gte('created_at', hourAgo);
  if (countError) {
    console.error('[free-audit-signup] limit check failed');
    return res.status(503).json({ error: 'Sign-up is temporarily unavailable' });
  }
  if (count >= SIGNUPS_PER_HOUR) {
    return res.status(429).json({ error: 'Too many sign-ups. Please try again later.' });
  }

  // Existing client with this email: change nothing and answer as for a new sign-up.
  const { data: existingProfile, error: existingError } = await supabase.from('profiles')
    .select('id').eq('email', emailNorm).limit(1).maybeSingle();
  if (existingError) {
    console.error('[free-audit-signup] profile check failed');
    return res.status(503).json({ error: 'Sign-up is temporarily unavailable' });
  }
  if (existingProfile) return res.status(200).json(ACCEPTED);

  // 1. Create the login and its set-password link. No password is accepted here,
  //    and nothing is emailed until the account is fully set up.
  const { user: newUser, link, created, error: authError } = await createSetPasswordLink(supabase, {
    type: 'invite', email: emailNorm, data: { full_name: fullName, company_name: companyName },
  });

  if (isEmailExists(authError) || (!authError && !created)) {
    // Existing account (confirmed or not): change nothing, delete nothing, and
    // answer exactly as for a new sign-up.
    return res.status(200).json(ACCEPTED);
  }
  if (authError) {
    console.error('[free-audit-signup] link error:', authError.code || 'unknown');
    if (created && newUser?.id) await supabase.auth.admin.deleteUser(newUser.id);
    return res.status(500).json({ error: 'Account creation failed' });
  }

  const userId = newUser.id;

  async function rollback() {
    const { error: delError } = await supabase.auth.admin.deleteUser(userId);
    if (delError) {
      console.error('[CRITICAL] Orphaned auth user:', userId, delError.code || 'unknown');
    }
  }

  // 2. Insert profile
  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    full_name: fullName,
    company_name: companyName,
    email: emailNorm,
    role: 'client',
  });

  if (profileError) {
    console.error('[free-audit-signup] profile insert error:', profileError.code || 'unknown');
    await rollback();
    return res.status(500).json({ error: 'Setup failed' });
  }

  // 3. Insert consent records
  const userAgent = req.headers['user-agent'] || null;
  const now = new Date().toISOString();
  const { error: consentError } = await supabase.from('consents').insert(
    ['terms_of_service', 'privacy_policy', 'app8_overseas_disclosure'].map(type => ({
      user_id: userId,
      consent_type: type,
      consent_text: CONSENT_TEXT[type],
      consented_at: now,
      user_agent: userAgent,
      version: CONSENT_VERSION,
    }))
  );

  if (consentError) {
    console.error('[free-audit-signup] consent insert error:', consentError.code || 'unknown');
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
    console.error('[free-audit-signup] engagement insert error:', engError.code || 'unknown');
    await rollback();
    return res.status(500).json({ error: 'Setup failed' });
  }

  // 5. Set-password email. Without it the client cannot sign in, so a delivery
  //    failure removes the account and asks them to try again.
  try {
    await sendSetPasswordEmail({ email: emailNorm, name: fullName, purpose: 'free_audit', link });
  } catch (emailErr) {
    console.error('[free-audit-signup] set-password email failed:', emailErr.message);
    await rollback();
    return res.status(503).json({ error: 'We could not send your email. Please try again shortly.' });
  }

  // 6. Welcome email to the signee — best-effort, non-fatal
  try {
    const firstName = fullName.split(/\s+/)[0];
    await sendEmail({
      from: 'Ethos AI Governance <mike@ethosaigovernance.com.au>',
      to: emailNorm,
      subject: 'Your free AI governance audit is booked in',
      html: `
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Thanks for claiming a free audit slot for ${escapeHtml(companyName)}. Use the separate email we have just sent to set your portal password.</p>
        <p>Here's what happens next:</p>
        <ol>
          <li>We confirm your audit slot within one business day. Audits are limited to three per month.</li>
          <li>You complete a short questionnaire in your <a href="https://ethosaigovernance.com.au/portal/login">secure portal</a>.</li>
          <li>Your traffic-light report against the Privacy Act, the Australian Privacy Principles and OAIC guidance is delivered within five business days.</li>
        </ol>
        <p>No pitch, no obligation.</p>
        <p>Mike<br/>Ethos AI Governance</p>
      `,
    });
  } catch (emailErr) {
    console.error('[free-audit-signup] welcome email error (non-fatal):', emailErr.message);
  }

  // 7. Admin notification — best-effort, non-fatal
  try {
    await sendEmail({
      from: 'Ethos Portal <noreply@ethosaigovernance.com.au>',
      to: process.env.NOTIFY_EMAIL,
      subject: 'New free audit signup',
      html: `
        <p>A new free audit account has been created and is pending your review. The client has been sent a link to set their password.</p>
        <table>
          <tr><td><strong>Name:</strong></td><td>${escapeHtml(fullName)}</td></tr>
          <tr><td><strong>Company:</strong></td><td>${escapeHtml(companyName)}</td></tr>
          <tr><td><strong>Email:</strong></td><td>${escapeHtml(emailNorm)}</td></tr>
        </table>
        <p><a href="https://ethosaigovernance.com.au/portal/admin">Open admin portal</a> to review and confirm their audit slot.</p>
      `,
    });
  } catch (emailErr) {
    console.error('[free-audit-signup] Resend error (non-fatal):', emailErr.message);
  }

  return res.status(200).json(ACCEPTED);
};
