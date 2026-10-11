-- ============================================================
-- ETHOS — Consents Table (schema + RLS hardening)
-- Run in Supabase Dashboard > SQL Editor
--
-- NOTE: this table already exists in production (it was created
-- directly in the dashboard and never checked in — signup inserts
-- into it via api/free-audit-signup.js). This file documents the
-- schema in the repo and adds the RLS policies. CREATE TABLE IF
-- NOT EXISTS makes it safe to run as-is.
--
-- Writers: service-role API routes only (free-audit-signup.js,
-- record-consents.js, stripe-webhook.js). There is deliberately
-- no INSERT policy for authenticated users.
-- ============================================================


-- ─── consents ─────────────────────────────────────────────────
-- One row per consent given. consent_type values in use:
--   terms_of_service, privacy_policy, app8_overseas_disclosure
--   (signup form and first-login gate), engagement_terms
--   (Stripe checkout, recorded by the webhook).

CREATE TABLE IF NOT EXISTS consents (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  consent_type TEXT NOT NULL,
  consent_text TEXT,                 -- the exact text agreed to (audit trail)
  consented_at TIMESTAMPTZ NOT NULL,
  user_agent   TEXT,                 -- browser UA, or stripe-checkout:<session id>
  version      TEXT NOT NULL,        -- consent text version, e.g. '1.0'
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consents_user_id_idx ON consents (user_id);


-- ─── RLS: consents ────────────────────────────────────────────

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;

-- Users can read their own consent records
CREATE POLICY "consents_own_read" ON consents
  FOR SELECT USING (user_id = auth.uid());

-- Admins can read all consent records
CREATE POLICY "consents_admin_read" ON consents
  FOR SELECT USING (is_admin());

-- No INSERT/UPDATE/DELETE policies: writes go through the
-- service role (API routes), which bypasses RLS.
