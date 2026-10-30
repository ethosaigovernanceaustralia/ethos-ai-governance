'use strict';
const { sendEmail } = require('./email');
const { escapeHtml } = require('./html');

// Supabase's built-in mailer is rate-limited (a few emails an hour), so the app
// asks Supabase only for the secure link and sends Ethos-branded email itself
// through Resend, the same pattern as api/send-password-reset.js.
const REDIRECT = 'https://ethosaigovernance.com.au/portal/reset-password';

const COPY = {
  free_audit: {
    subject: 'Set your Ethos portal password',
    intro: 'Thanks for claiming a free AI governance audit. Set a password to open your secure client portal, where you will complete a short questionnaire and receive your report.',
    button: 'Set your password',
  },
  purchase: {
    subject: 'Your Ethos portal is ready: set your password',
    intro: 'Thank you for your purchase. Your governance templates and invoice are in your secure client portal. Set a password to sign in.',
    button: 'Set your password',
  },
  portal_invite: {
    subject: 'Your Ethos client portal: set your password',
    intro: 'Your Ethos advisor has set up a secure client portal for you, for documents, messages and progress updates. Set a password to sign in.',
    button: 'Set your password',
  },
  reclaim: {
    subject: 'Set your Ethos portal password',
    intro: 'Your purchase has been added to the Ethos client portal account for this email address. For your security, please set a new password before signing in.',
    button: 'Set a new password',
  },
};

function setPasswordEmailHtml(link, name, purpose) {
  const copy = COPY[purpose];
  const first = String(name || '').trim().split(/\s+/)[0];
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#0D1F3C;padding:24px 32px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.05em">ETHOS</div>
        <div style="font-size:11px;color:#A8833A;margin-top:3px">AI Governance</div>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <p style="font-size:15px;color:#111827;margin-top:0">Hi${first ? ` ${escapeHtml(first)}` : ''},</p>
        <p style="font-size:15px;color:#111827">${copy.intro}</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(link)}"
             style="background:#0D1F3C;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">
            ${copy.button}
          </a>
        </p>
        <p style="font-size:13px;color:#6b7280">This link can be used once and expires in 24 hours. If it has expired, use Forgot your password on the portal sign-in page.</p>
        <p style="font-size:13px;color:#6b7280">If you did not expect this email, you can ignore it. No one can sign in to this account without the link.</p>
        <p style="font-size:14px;color:#374151;margin-bottom:0">Mike, Ethos AI Governance</p>
      </div>
      <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px">Ethos AI Governance · ethosaigovernance.com.au</p>
    </div>
  `;
}

// type 'invite' creates the login. For an address that already has a login,
// Supabase either returns error code email_exists (confirmed logins) or returns the
// EXISTING user (unconfirmed logins), so `created` reports whether this call made
// the login. A brand-new invite has invited_at equal to created_at (both set by
// Supabase, so server clocks do not matter); re-inviting an existing login moves
// invited_at but keeps the original created_at. Callers must never delete a login
// unless `created` is true. 'recovery' is for an existing login. No email is sent.
// Returns { user, link, created, error }.
async function createSetPasswordLink(supabase, { type, email, data }) {
  const { data: result, error } = await supabase.auth.admin.generateLink({
    type, email, options: { redirectTo: REDIRECT, ...(data ? { data } : {}) },
  });
  if (error) return { user: null, link: null, created: false, error };
  const user = result?.user || null;
  const created = type === 'invite' && Boolean(user?.created_at && user?.invited_at) &&
    Math.abs(new Date(user.invited_at) - new Date(user.created_at)) < 250;  // measured: ~0.3 ms when new
  const link = result?.properties?.action_link;
  if (!link) return { user, link: null, created, error: new Error('No link generated') };
  return { user, link, created, error: null };
}

// Throws if delivery fails.
async function sendSetPasswordEmail({ email, name, purpose, link }) {
  await sendEmail({
    from: 'Ethos AI Governance <mike@ethosaigovernance.com.au>',
    to: email,
    subject: COPY[purpose].subject,
    html: setPasswordEmailHtml(link, name, purpose),
  });
}

const isEmailExists = error => Boolean(error) &&
  (error.code === 'email_exists' || /already (been )?registered/i.test(error.message || ''));

module.exports = { createSetPasswordLink, sendSetPasswordEmail, setPasswordEmailHtml, isEmailExists };
