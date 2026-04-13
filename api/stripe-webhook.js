// ─── Ethos — Stripe Webhook Handler ──────────────────────────────────────────
// Vercel serverless function. Runs server-side only.
// Receives events from Stripe and triggers post-purchase automation.
//
// Events handled (Stage 2):
//   checkout.session.completed  → grant access, create invoice, send invite
//   checkout.session.expired    → mark abandoned checkout
//
// Stripe requires the raw request body (not parsed JSON) to verify the
// signature. Vercel provides this via req.body as a Buffer when
// bodyParser is disabled (see config export below).
// ─────────────────────────────────────────────────────────────────────────────

const Stripe = require('stripe');

// Disable Vercel's default body parsing so we get the raw Buffer for
// signature verification — this is required by Stripe
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// Helper: read the raw request body as a Buffer
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Read raw body and verify Stripe signature
  let event;
  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Route events
  switch (event.type) {
    case 'checkout.session.completed':
      // TODO (Stage 2): handle successful payment
      // - Grant product access (idempotent via stripe_session_id)
      // - Create profile + send invite if new customer
      // - Generate and store invoice PDF
      // - Send branded invoice + welcome email via Resend
      console.log('checkout.session.completed:', event.data.object.id);
      break;

    case 'checkout.session.expired':
      // TODO (Stage 2): record abandoned checkout for recovery email
      console.log('checkout.session.expired:', event.data.object.id);
      break;

    default:
      // Ignore unhandled event types
      break;
  }

  // Acknowledge receipt — Stripe will retry if we don't return 200
  return res.status(200).json({ received: true });
};
