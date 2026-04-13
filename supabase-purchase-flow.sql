-- ============================================================
-- ETHOS — Purchase Flow Tables (Stage 1)
-- Run in Supabase Dashboard > SQL Editor
-- ============================================================


-- ─── product_templates ────────────────────────────────────────
-- Master template files shared across all clients on a tier.
-- Admin populates this manually before launch (7 files for au_compliance_core).

CREATE TABLE IF NOT EXISTS product_templates (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  product_tier TEXT    NOT NULL CHECK (product_tier IN ('au_compliance_core', 'full_toolkit')),
  display_name TEXT    NOT NULL,
  file_path    TEXT    NOT NULL,       -- storage path in client-documents bucket
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ─── product_access ───────────────────────────────────────────
-- One row per purchase. Revocable without deleting (history preserved).
-- stripe_session_id is the idempotency key — webhook inserts are safe to retry.

CREATE TABLE IF NOT EXISTS product_access (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  product_tier      TEXT NOT NULL CHECK (product_tier IN ('au_compliance_core', 'full_toolkit')),
  granted_at        TIMESTAMPTZ DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ,           -- NULL = active; set to revoke
  stripe_session_id TEXT NOT NULL UNIQUE,  -- prevents duplicate webhook processing
  created_at        TIMESTAMPTZ DEFAULT NOW()
);


-- ─── invoices ─────────────────────────────────────────────────
-- One row per purchase. Invoice number starts at ETH-24050 and increments.
-- file_path is NULL until the PDF is generated and stored.

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 24050;

CREATE TABLE IF NOT EXISTS invoices (
  id                UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         UUID    REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  invoice_number    TEXT    NOT NULL UNIQUE
                            DEFAULT 'ETH-' || LPAD(nextval('invoice_number_seq')::TEXT, 5, '0'),
  product_tier      TEXT    NOT NULL,
  amount_aud_cents  INTEGER NOT NULL,  -- e.g. 99900 for $999.00 AUD
  stripe_session_id TEXT    UNIQUE,    -- links invoice to the checkout session
  file_path         TEXT,              -- NULL until PDF is generated
  issued_at         TIMESTAMPTZ DEFAULT NOW(),
  last_emailed_at   TIMESTAMPTZ,
  email_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);


-- ─── template_downloads ───────────────────────────────────────
-- Log every template download. Simple append-only table.
-- Used in admin portal to see whether a client has actually used their purchase.

CREATE TABLE IF NOT EXISTS template_downloads (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  template_id   UUID REFERENCES product_templates(id) ON DELETE CASCADE NOT NULL,
  downloaded_at TIMESTAMPTZ DEFAULT NOW()
);


-- ─── abandoned_checkouts ──────────────────────────────────────
-- Recorded when checkout.session.expired fires.
-- completed_at is set if the customer later completes a new session.

CREATE TABLE IF NOT EXISTS abandoned_checkouts (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_session_id       TEXT NOT NULL UNIQUE,
  customer_email          TEXT,
  product_tier            TEXT NOT NULL,
  abandoned_at            TIMESTAMPTZ DEFAULT NOW(),
  recovery_email_sent_at  TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);


-- ─── ENABLE ROW LEVEL SECURITY ────────────────────────────────

ALTER TABLE product_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_access      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_downloads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE abandoned_checkouts ENABLE ROW LEVEL SECURITY;


-- ─── RLS: product_templates ───────────────────────────────────

-- Clients can read templates for tiers they currently have active access to
CREATE POLICY "product_templates_client_read" ON product_templates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM product_access pa
      WHERE pa.client_id = auth.uid()
        AND pa.product_tier = product_templates.product_tier
        AND pa.revoked_at IS NULL
    )
  );

-- Admins can do everything
CREATE POLICY "product_templates_admin_all" ON product_templates
  FOR ALL USING (is_admin());

-- Service role full access (for webhook handler)
CREATE POLICY "product_templates_service_all" ON product_templates
  FOR ALL USING (auth.role() = 'service_role');


-- ─── RLS: product_access ──────────────────────────────────────

-- Clients can read their own access records
CREATE POLICY "product_access_client_read" ON product_access
  FOR SELECT USING (client_id = auth.uid());

-- Admins can do everything
CREATE POLICY "product_access_admin_all" ON product_access
  FOR ALL USING (is_admin());

-- Service role full access (for webhook handler — insert on purchase, update on revoke)
CREATE POLICY "product_access_service_all" ON product_access
  FOR ALL USING (auth.role() = 'service_role');


-- ─── RLS: invoices ────────────────────────────────────────────

-- Clients can read their own invoices
CREATE POLICY "invoices_client_read" ON invoices
  FOR SELECT USING (client_id = auth.uid());

-- Admins can do everything
CREATE POLICY "invoices_admin_all" ON invoices
  FOR ALL USING (is_admin());

-- Service role full access (for webhook handler)
CREATE POLICY "invoices_service_all" ON invoices
  FOR ALL USING (auth.role() = 'service_role');


-- ─── RLS: template_downloads ──────────────────────────────────

-- Clients can insert their own download records
CREATE POLICY "template_downloads_client_insert" ON template_downloads
  FOR INSERT WITH CHECK (client_id = auth.uid());

-- Admins can read all download records (for activity view in Stage 3)
CREATE POLICY "template_downloads_admin_read" ON template_downloads
  FOR SELECT USING (is_admin());

-- Service role full access
CREATE POLICY "template_downloads_service_all" ON template_downloads
  FOR ALL USING (auth.role() = 'service_role');


-- ─── RLS: abandoned_checkouts ─────────────────────────────────

-- No client access — admin and internal only
CREATE POLICY "abandoned_checkouts_admin_read" ON abandoned_checkouts
  FOR SELECT USING (is_admin());

-- Service role full access (webhook handler writes these)
CREATE POLICY "abandoned_checkouts_service_all" ON abandoned_checkouts
  FOR ALL USING (auth.role() = 'service_role');
