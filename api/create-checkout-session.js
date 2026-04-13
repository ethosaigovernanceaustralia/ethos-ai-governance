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
    const session = await stripe.checkout.sessions.create({
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
      // To add Terms of Service consent in future:
      // 1. Add a /terms page to the website
      // 2. Set the URL in Stripe Dashboard > Settings > Checkout & Payment Links > Terms of service
      // 3. Uncomment: consent_collection: { terms_of_service: 'required' }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[checkout] Session creation error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
};
