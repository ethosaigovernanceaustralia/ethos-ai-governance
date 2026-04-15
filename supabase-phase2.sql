-- ============================================================
-- ETHOS AI GOVERNANCE — Phase 2 Migration
-- Run in Supabase Dashboard > SQL Editor
-- Covers:
--   1. Engagement type alignment (new product tiers)
--   2. Migrate legacy engagement types
--   3. Add progress_stage column to engagements
--   4. Create action_items table + RLS
--   5. Add client read policy for template_downloads
-- ============================================================


-- ─── 1. Fix engagement_type CHECK constraint ─────────────────

-- Drop the existing CHECK constraint (auto-named by Postgres)
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'engagements'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%engagement_type%';
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE engagements DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END;
$$;

-- Migrate legacy types to the closest current equivalent
UPDATE engagements
SET engagement_type = 'au_compliance_core'
WHERE engagement_type IN ('toolkit_self_service', 'toolkit_consulting');

-- Add the new constraint with the current five tiers
ALTER TABLE engagements
  ADD CONSTRAINT engagements_engagement_type_check
  CHECK (engagement_type IN (
    'free_audit',
    'au_compliance_core',
    'full_toolkit',
    'retainer',
    'iso_pathway'
  ));


-- ─── 2. Add progress_stage column ────────────────────────────

ALTER TABLE engagements
  ADD COLUMN IF NOT EXISTS progress_stage TEXT;


-- ─── 3. Create action_items table ────────────────────────────

CREATE TABLE IF NOT EXISTS action_items (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  engagement_id UUID REFERENCES engagements(id) ON DELETE CASCADE NOT NULL,
  client_id     UUID REFERENCES profiles(id)    ON DELETE CASCADE NOT NULL,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'complete')),
  assigned_to   TEXT NOT NULL DEFAULT 'client'
                  CHECK (assigned_to IN ('client', 'ethos')),
  due_date      DATE,
  notes         TEXT,
  document_id   UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES profiles(id) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;

-- Clients: read only items assigned to them
CREATE POLICY "action_items_client_read" ON action_items
  FOR SELECT USING (client_id = auth.uid() AND assigned_to = 'client');

-- Clients: mark their own assigned items complete (update status only)
CREATE POLICY "action_items_client_update" ON action_items
  FOR UPDATE USING (client_id = auth.uid() AND assigned_to = 'client');

-- Admins: full access to all action items
CREATE POLICY "action_items_admin_all" ON action_items
  FOR ALL USING (is_admin());


-- ─── 4. Ensure clients can read their own template_downloads ──
-- (Needed for the au_compliance_core progress display on the client dashboard)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'template_downloads'
      AND policyname = 'template_downloads_client_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "template_downloads_client_read" ON template_downloads
        FOR SELECT USING (client_id = auth.uid())
    $policy$;
  END IF;
END;
$$;


-- ─── 5. Ensure clients can read their own product_access rows ─
-- (Needed for retainer date display on the client dashboard)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'product_access'
      AND policyname = 'product_access_client_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_access_client_read" ON product_access
        FOR SELECT USING (client_id = auth.uid() AND revoked_at IS NULL)
    $policy$;
  END IF;
END;
$$;
