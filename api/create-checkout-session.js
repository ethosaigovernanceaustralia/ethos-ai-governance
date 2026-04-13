// ─── Ethos — Create Stripe Checkout Session ──────────────────────────────────
// Vercel serverless function. Runs server-side only.
// Creates a Stripe Checkout session for a product purchase.
// Stage 2 will wire this to the "Get AU Compliance Core" button.
// ─────────────────────────────────────────────────────────────────────────────

const Stripe = require('stripe');

// Product configuration — single source of truth for prices and tiers
const PRODUCTS = {
  au_compliance_core: {
    name: 'AU Compliance Core',
    amount: 99900, // $999.00 AUD in cents
    currency: 'aud',
  },
  full_toolkit: {
    name: 'Full Responsible AI Toolkit',
    amount: 169900, // $1,699.00 AUD in cents
    currency: 'aud',
  },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // TODO (Stage 2): implement checkout session creation
  // Will accept { productTier } in request body
  // Will create a Stripe Checkout session and return { url }

  return res.status(501).json({ error: 'Not yet implemented — coming in Stage 2' });
};
