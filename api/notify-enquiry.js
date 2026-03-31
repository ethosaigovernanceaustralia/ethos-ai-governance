// ─── Ethos — New Enquiry Email Notification ──────────────────────────────────
// Called by the frontend after a form submission is inserted into Supabase.
// Sends a notification email to the Ethos admin using Resend.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, company, email, company_builds, enquiry_prompt, team_size, interested_in, existing_governance, additional_notes } = req.body;

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL; // your email address

  if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
    // Not configured — fail silently so the user never sees an error
    return res.status(200).json({ ok: true });
  }

  const interestLabels = {
    free_audit:  'Free AI Governance Audit',
    toolkit:     'Baseline Compliance Toolkit',
    iso_pathway: 'ISO 42001 Readiness Pathway',
    retainer:    'Governance Retainer',
    general:     'General enquiry',
  };
  const promptLabels = {
    enterprise_governance: 'Enterprise client requiring governance documentation',
    investor_board:        'Investor or board governance question',
    iso42001:              'Preparing for ISO 42001 certification',
    procurement:           'Upcoming procurement or tender',
    proactive:             'Proactive — getting ahead of regulation',
    other:                 'Other',
  };

  const interests = (interested_in || []).map(v => interestLabels[v] || v).join(', ') || '—';
  const prompt    = promptLabels[enquiry_prompt] || enquiry_prompt || '—';

  const html = `
    <h2 style="font-family:sans-serif;color:#0D1F3C;margin-bottom:8px">New Enquiry — Ethos AI Governance</h2>
    <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:560px">
      <tr><td style="padding:8px 0;color:#6b7280;width:180px">Name</td><td style="padding:8px 0;font-weight:600;color:#111">${name}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">Company</td><td style="padding:8px 0;font-weight:600;color:#111">${company}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">Email</td><td style="padding:8px 0"><a href="mailto:${email}" style="color:#C9A84C">${email}</a></td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">What they build</td><td style="padding:8px 0;color:#111">${company_builds || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">What prompted</td><td style="padding:8px 0;color:#111">${prompt}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">Team size</td><td style="padding:8px 0;color:#111">${team_size || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">Interested in</td><td style="padding:8px 0;color:#111">${interests}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">Existing docs</td><td style="padding:8px 0;color:#111">${existing_governance || '—'}</td></tr>
      ${additional_notes ? `<tr><td style="padding:8px 0;color:#6b7280;vertical-align:top">Notes</td><td style="padding:8px 0;color:#111">${additional_notes}</td></tr>` : ''}
    </table>
    <p style="font-family:sans-serif;font-size:12px;color:#9ca3af;margin-top:24px">Ethos AI Governance — ethosaigovernance.com.au</p>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Ethos Website <hello@ethosaigovernance.com.au>',
        to:   [NOTIFY_EMAIL],
        subject: `New enquiry from ${name} — ${company}`,
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend error:', err);
    }
  } catch (err) {
    console.error('Notify error:', err);
  }

  // Always return 200 — notification failure should never surface to the user
  return res.status(200).json({ ok: true });
};
