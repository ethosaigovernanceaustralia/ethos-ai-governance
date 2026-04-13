-- ============================================================
-- ETHOS — Storage Setup: ethos-assets bucket
-- Run in Supabase Dashboard > SQL Editor
-- ============================================================


-- ─── Create the bucket ────────────────────────────────────────
-- Private (public: false) — all access via signed URLs only.
-- Folder structure:
--   templates/au-compliance-core/   ← 7 master template files
--   templates/full-toolkit/         ← ready for Stage 3
--   invoices/                       ← generated invoice PDFs

INSERT INTO storage.buckets (id, name, public)
VALUES ('ethos-assets', 'ethos-assets', false)
ON CONFLICT (id) DO NOTHING;


-- ─── RLS: ethos-assets ────────────────────────────────────────

-- Clients can read template files for tiers they have active access to
CREATE POLICY "ethos_assets_templates_client_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ethos-assets'
    AND (
      (name LIKE 'templates/au-compliance-core/%'
        AND EXISTS (
          SELECT 1 FROM product_access pa
          WHERE pa.client_id = auth.uid()
            AND pa.product_tier = 'au_compliance_core'
            AND pa.revoked_at IS NULL
        )
      )
      OR
      (name LIKE 'templates/full-toolkit/%'
        AND EXISTS (
          SELECT 1 FROM product_access pa
          WHERE pa.client_id = auth.uid()
            AND pa.product_tier = 'full_toolkit'
            AND pa.revoked_at IS NULL
        )
      )
    )
  );

-- Clients can read their own invoice PDFs
CREATE POLICY "ethos_assets_invoices_client_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ethos-assets'
    AND name LIKE 'invoices/%'
    AND EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.client_id = auth.uid()
        AND i.file_path = name
    )
  );

-- Admins can read and write everything in the bucket
CREATE POLICY "ethos_assets_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'ethos-assets'
    AND is_admin()
  )
  WITH CHECK (
    bucket_id = 'ethos-assets'
    AND is_admin()
  );

-- Note: service role bypasses RLS automatically — no policy needed.
-- The webhook handler (which uses the service role key) can upload
-- invoice PDFs and the admin can upload template files without
-- any additional policy.
