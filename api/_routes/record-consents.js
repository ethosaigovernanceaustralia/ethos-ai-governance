// ─── Ethos — Record Portal Consents ──────────────────────────────────────────
// Vercel serverless function. Authenticated portal users only.
// Backs the first-login consent gate in portal/dashboard.html for accounts
// that were created without the signup form (e.g. invited after a Stripe
// purchase) and therefore never ticked the three consent checkboxes.
//
//   GET  /api/record-consents  → { consents: ['terms_of_service', ...] }
//   POST /api/record-consents  { consents: { terms, privacy, app8 } }
//                              → records the three consent rows (idempotent)
//
// Writes go through the service role so the consents table stays closed to
// client-side inserts. Same row shape as free-audit-signup.js.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const { CONSENT_VERSION, CONSENT_TEXT } = require('./_consent-constants');

const GATED_TYPES = ['terms_of_service', 'privacy_policy', 'app8_overseas_disclosure'];

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = getSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Fetch the caller's existing consent types (used by both methods)
  const { data: existing, error: fetchError } = await supabase
    .from('consents')
    .select('consent_type')
    .eq('user_id', user.id);

  if (fetchError) {
    console.error('[record-consents] fetch error:', fetchError);
    return res.status(500).json({ error: 'Could not read consents' });
  }

  const held = (existing || []).map((row) => row.consent_type);

  if (req.method === 'GET') {
    return res.status(200).json({ consents: held });
  }

  // POST — all three boxes must be ticked
  const { consents } = req.body || {};
  if (
    consents?.terms !== true ||
    consents?.privacy !== true ||
    consents?.app8 !== true
  ) {
    return res.status(400).json({ error: 'Consent required' });
  }

  // Idempotent: only insert the types the user does not already hold
  const missing = GATED_TYPES.filter((type) => !held.includes(type));
  if (missing.length === 0) {
    return res.status(200).json({ success: true, recorded: [] });
  }

  const userAgent = req.headers['user-agent'] || null;
  const now = new Date().toISOString();

  const rows = missing.map((type) => ({
    user_id: user.id,
    consent_type: type,
    consent_text: CONSENT_TEXT[type],
    consented_at: now,
    user_agent: userAgent,
    version: CONSENT_VERSION,
  }));

  const { error: insertError } = await supabase.from('consents').insert(rows);
  if (insertError) {
    console.error('[record-consents] insert error:', insertError);
    return res.status(500).json({ error: 'Could not record consents' });
  }

  return res.status(200).json({ success: true, recorded: missing });
};
