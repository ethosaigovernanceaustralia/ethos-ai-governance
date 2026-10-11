// ─── Ethos — Create Stripe Checkout Session ──────────────────────────────────
// Vercel serverless function. Runs server-side only.
// Called by the "Get AU Compliance Core" button on the website.
// Returns a Stripe-hosted checkout URL and redirects the browser there.
// ─────────────────────────────────────────────────────────────────────────────

const Stripe = require('stripe');

// Single source of truth for products. Add full_toolkit here when ready.
const PRODUCTS = {
  au_compliance_core: {
    name: 'AU Compliance Core',
    amount: 99900,   // $999.00 AUD in cents
    currency: 'aud',
  },
  full_toolkit: {
    name: 'Full Responsible AI Toolkit',
    amount: 169900,  // $1,699.00 AUD in cents
    currency: 'aud',
  },
};

const SITE_URL = 'https://ethosaigovernance.com.au';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productTier } = req.body;

  if (!productTier || !PRODUCTS[productTier]) {
    return res.status(400).json({ error: 'Invalid product tier' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const product = PRODUCTS[productTier];

  try {
    const params = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: product.currency,
          product_data: { name: product.name },
          unit_amount: product.amount,
        },
        quantity: 1,
      }],
      billing_address_collection: 'auto',
      // product_tier stored in metadata so the webhook knows what was purchased
      metadata: { product_tier: productTier },
      success_url: `${SITE_URL}/success?tier=${productTier}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${SITE_URL}/#services`,
    };

    // Stripe's hosted Terms-of-Service checkbox. This REQUIRES a Terms of
    // Service URL to be set in Stripe Dashboard > Settings > Checkout &
    // Payment Links; Stripe rejects session creation if consent_collection
    // is set without it. Engagement Terms are now also captured in-app before
    // this call (see openEngagementTerms in app.js), so the hosted checkbox is
    // opt-in via env to avoid breaking checkout before the ToS URL / final
    // legal doc exists. Set STRIPE_COLLECT_TOS=true once the URL is configured.
    // When enabled, acceptance is recorded to the consents table by stripe-webhook.js.
    if (process.env.STRIPE_COLLECT_TOS === 'true') {
      params.consent_collection = { terms_of_service: 'required' };
    }

    const session = await stripe.checkout.sessions.create(params);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[checkout] Session creation error:', err.type || err.code || 'unknown');
    return res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
};
