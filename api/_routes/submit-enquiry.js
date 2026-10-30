// ─── Ethos — Enquiry Submission ──────────────────────────────────────────────
// The single entry point for website enquiries (security plan P6).
// Validates and bounds the fields, applies durable volume limits, saves the
// enquiry with server-owned status and timestamps, and only then notifies the
// Ethos admin. Notification failure never loses a saved enquiry.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const { validateEnquiry, enquiryEmailHtml } = require('../../lib/enquiry');
const { missingEnvironment } = require('../../lib/environment');

// Durable limits, counted from saved enquiries rather than per-instance memory.
const PER_EMAIL_PER_HOUR = 3;
const SITE_WIDE_PER_TEN_MINUTES = 30;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (missingEnvironment(['SUPABASE_URL', 'SUPABASE_SECRET_KEY']).length) {
    return res.status(503).json({ error: 'Enquiries are temporarily unavailable' });
  }

  const { value: enquiry, errors } = validateEnquiry(req.body);
  if (errors) {
    return res.status(400).json({ error: 'Please check the highlighted fields', fields: errors });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const [byEmail, siteWide] = await Promise.all([
    supabase.from('enquiries').select('id', { count: 'exact', head: true })
      .eq('email', enquiry.email).gte('created_at', hourAgo),
    supabase.from('enquiries').select('id', { count: 'exact', head: true })
      .gte('created_at', tenMinutesAgo),
  ]);
  if (byEmail.error || siteWide.error) {
    console.error('Enquiry limit check failed');
    return res.status(503).json({ error: 'Enquiries are temporarily unavailable' });
  }
  if (byEmail.count >= PER_EMAIL_PER_HOUR || siteWide.count >= SITE_WIDE_PER_TEN_MINUTES) {
    return res.status(429).json({ error: 'Too many enquiries. Please try again later.' });
  }

  const { error: insertError } = await supabase.from('enquiries').insert(enquiry);
  if (insertError) {
    console.error('Enquiry insert failed:', insertError.code || 'unknown');
    return res.status(503).json({ error: 'Enquiries are temporarily unavailable' });
  }

  // Saved. Notify the admin; a failure here is logged, not shown to the visitor.
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
  if (RESEND_API_KEY && NOTIFY_EMAIL) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Ethos Website <mike@ethosaigovernance.com.au>',
          to: [NOTIFY_EMAIL],
          subject: `New enquiry from ${enquiry.name.replace(/[\r\n]+/g, ' ').slice(0, 100)}`,
          html: enquiryEmailHtml(enquiry),
        }),
      });
      if (!response.ok) console.error('Enquiry notification failed:', response.status);
    } catch {
      console.error('Enquiry notification failed');
    }
  }

  return res.status(200).json({ ok: true });
};
