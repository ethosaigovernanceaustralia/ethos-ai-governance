-- ─── Ethos — Email Suppression List ──────────────────────────────────────────
-- Run in the Supabase SQL editor after supabase-purchase-flow.sql.
-- Backs the unsubscribe link in the abandoned-checkout recovery email
-- (Spam Act 2003 requires a functional unsubscribe facility on every
-- commercial electronic message). Any address here must never receive
-- another recovery email, regardless of which checkout it comes from.
-- Public access goes exclusively through /api/unsubscribe (service key).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_suppressions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL UNIQUE,
  source           TEXT NOT NULL DEFAULT 'checkout_recovery',
  unsubscribed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_suppressions_admin" ON email_suppressions
  FOR ALL USING (is_admin());
