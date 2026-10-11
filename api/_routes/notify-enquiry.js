// ─── Ethos — Retired enquiry notification route ──────────────────────────────
// This route used to send the admin an email for any unauthenticated request,
// whether or not an enquiry had been saved. Enquiries now go through
// /api/submit-enquiry, which saves first and then notifies. The route stays
// as a stub so cached pages calling it fail harmlessly without sending email.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  return res.status(410).json({ error: 'This endpoint has been retired' });
};
