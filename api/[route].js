// ─── Ethos — API dispatcher ──────────────────────────────────────────────────
// Vercel's Hobby plan allows at most 12 serverless functions per deployment.
// Every /api/<name> URL is served by this one function, which hands the request
// to the matching handler in api/_routes/ (underscore paths are not deployed as
// separate functions). Handlers load lazily so a cold start only pays for the
// route being called. URLs, request bodies and responses are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const routes = {
  'booking': () => require('./_routes/booking.js'),
  'create-checkout-session': () => require('./_routes/create-checkout-session.js'),
  'csp-report': () => require('./_routes/csp-report.js'),
  'delete-client': () => require('./_routes/delete-client.js'),
  'free-audit-signup': () => require('./_routes/free-audit-signup.js'),
  'get-client-status': () => require('./_routes/get-client-status.js'),
  'invite-client': () => require('./_routes/invite-client.js'),
  'notify-enquiry': () => require('./_routes/notify-enquiry.js'),
  'record-consents': () => require('./_routes/record-consents.js'),
  'resend-invite': () => require('./_routes/resend-invite.js'),
  'resend-invoice': () => require('./_routes/resend-invoice.js'),
  'revoke-access': () => require('./_routes/revoke-access.js'),
  'send-notification': () => require('./_routes/send-notification.js'),
  'send-password-reset': () => require('./_routes/send-password-reset.js'),
  'send-recovery-emails': () => require('./_routes/send-recovery-emails.js'),
  'stripe-webhook': () => require('./_routes/stripe-webhook.js'),
  'submit-enquiry': () => require('./_routes/submit-enquiry.js'),
  'unsubscribe': () => require('./_routes/unsubscribe.js'),
};

module.exports = async function dispatch(req, res) {
  const name = new URL(req.url, 'http://localhost').pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!Object.hasOwn(routes, name)) return res.status(404).json({ error: 'Not found' });
  return routes[name]()(req, res);
};
