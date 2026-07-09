// ─── Ethos — Shared Consent Constants ────────────────────────────────────────
// Single source of truth for the consent version and the exact text a user
// agrees to. Used by free-audit-signup.js (signup form), record-consents.js
// (first-login consent gate) and stripe-webhook.js (checkout terms record).
// Bump CONSENT_VERSION whenever any consent text changes.
// Files prefixed with an underscore are not exposed as Vercel routes.
// ─────────────────────────────────────────────────────────────────────────────

const CONSENT_VERSION = '1.0';

const CONSENT_TEXT = {
  terms_of_service: 'I agree to the Portal Terms of Service',
  privacy_policy: 'I agree to the Privacy Policy',
  app8_overseas_disclosure:
    'I expressly consent to my information being disclosed to overseas service providers (Supabase, USA; Resend, USA), and I acknowledge that APP 8.1 (reasonable steps) will not apply and that I may not be able to seek redress under the Privacy Act if an overseas recipient mishandles my information',
  engagement_terms: 'Agreed to the Engagement Terms at Stripe checkout',
};

module.exports = { CONSENT_VERSION, CONSENT_TEXT };
