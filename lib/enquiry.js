'use strict';
const { escapeHtml } = require('./html');

// Limits mirror the enquiries_field_lengths constraint in supabase-security-release1.sql.
const LIMITS = {
  name: 200, company: 200, email: 320, company_builds: 2000, enquiry_prompt: 5000,
  team_size: 50, existing_governance: 500, additional_notes: 5000,
};

const INTEREST_LABELS = {
  free_audit:  'Free AI Governance Audit',
  toolkit:     'Baseline Compliance Toolkit',
  iso_pathway: 'ISO 42001 Readiness Pathway',
  retainer:    'Governance Retainer',
  general:     'General enquiry',
};

const PROMPT_LABELS = {
  enterprise_governance: 'Enterprise client requiring governance documentation',
  investor_board:        'Investor or board governance question',
  iso42001:              'Preparing for ISO 42001 certification',
  procurement:           'Upcoming procurement or tender',
  proactive:             'Proactive: getting ahead of regulation',
  other:                 'Other',
};

const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

function text(value, field, errors, { required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') { errors.push(field); return ''; }
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > LIMITS[field]) errors.push(field);
  return trimmed;
}

// Returns { value } with only the stored columns, or { errors } naming invalid fields.
function validateEnquiry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['body'] };
  const errors = [];
  const value = {
    name: text(body.name, 'name', errors, { required: true }),
    company: text(body.company, 'company', errors),
    email: text(body.email, 'email', errors, { required: true }).toLowerCase(),
    company_builds: text(body.company_builds, 'company_builds', errors),
    enquiry_prompt: text(body.enquiry_prompt, 'enquiry_prompt', errors),
    team_size: text(body.team_size, 'team_size', errors),
    existing_governance: text(body.existing_governance, 'existing_governance', errors) || null,
    additional_notes: text(body.additional_notes, 'additional_notes', errors) || null,
  };
  if (value.email && !EMAIL_PATTERN.test(value.email)) errors.push('email');

  let interests = body.interested_in;
  if (interests === undefined || interests === null || (Array.isArray(interests) && !interests.length)) {
    interests = [Object.hasOwn(INTEREST_LABELS, body.enquiry_type) ? body.enquiry_type : 'general'];
  }
  if (!Array.isArray(interests) || interests.length > 10 ||
      !interests.every(item => typeof item === 'string' && Object.hasOwn(INTEREST_LABELS, item))) {
    errors.push('interested_in');
  }
  value.interested_in = Array.isArray(interests) ? [...new Set(interests)] : [];

  // A general enquiry must say something.
  if (!value.additional_notes && !value.company_builds && !value.enquiry_prompt) errors.push('additional_notes');
  return errors.length ? { errors: [...new Set(errors)] } : { value };
}

function enquiryEmailHtml(enquiry) {
  const interests = (Array.isArray(enquiry.interested_in) ? enquiry.interested_in : [])
    .map(v => Object.hasOwn(INTEREST_LABELS, v) ? INTEREST_LABELS[v] : v).join(', ') || '-';
  const prompt = (Object.hasOwn(PROMPT_LABELS, enquiry.enquiry_prompt)
    ? PROMPT_LABELS[enquiry.enquiry_prompt] : enquiry.enquiry_prompt) || '-';
  const row = (label, content, extra = '') =>
    `<tr><td style="padding:8px 0;color:#6b7280;width:180px;vertical-align:top">${label}</td><td style="padding:8px 0;color:#111${extra}">${content}</td></tr>`;
  return `
    <h2 style="font-family:sans-serif;color:#0D1F3C;margin-bottom:8px">New Enquiry: Ethos AI Governance</h2>
    <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:560px">
      ${row('Name', escapeHtml(enquiry.name), ';font-weight:600')}
      ${row('Company', escapeHtml(enquiry.company || '-'), ';font-weight:600')}
      ${row('Email', `<a href="mailto:${escapeHtml(enquiry.email)}" style="color:#A8833A">${escapeHtml(enquiry.email)}</a>`)}
      ${row('What they build', escapeHtml(enquiry.company_builds || '-'))}
      ${row('What prompted', escapeHtml(prompt))}
      ${row('Team size', escapeHtml(enquiry.team_size || '-'))}
      ${row('Interested in', escapeHtml(interests))}
      ${row('Existing docs', escapeHtml(enquiry.existing_governance || '-'))}
      ${enquiry.additional_notes ? row('Notes', escapeHtml(enquiry.additional_notes)) : ''}
    </table>
    <p style="font-family:sans-serif;font-size:12px;color:#9ca3af;margin-top:24px">Ethos AI Governance, ethosaigovernance.com.au</p>
  `;
}

module.exports = { validateEnquiry, enquiryEmailHtml, LIMITS };
