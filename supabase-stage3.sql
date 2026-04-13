-- ============================================================
-- ETHOS — Stage 3 Database Migration
-- Run in Supabase Dashboard > SQL Editor
-- ============================================================


-- ─── Part 2: Add 'refunded' and 'upgraded' to engagement status ───
-- Drops the old constraint (if any) and recreates it with the new values.

ALTER TABLE engagements DROP CONSTRAINT IF EXISTS engagements_status_check;
ALTER TABLE engagements ADD CONSTRAINT engagements_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'refunded', 'upgraded'));


-- ─── Part 5: Retainer tracking columns on product_access ─────────
-- Only populated when product_tier = 'full_toolkit'.
-- Retainer is 6 months from purchase date.

ALTER TABLE product_access
  ADD COLUMN IF NOT EXISTS retainer_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retainer_end_date   TIMESTAMPTZ;


-- ─── Part 5: Full Toolkit product templates ───────────────────────
-- Copies all existing au_compliance_core templates into a full_toolkit set.
-- Run this AFTER you have au_compliance_core templates already inserted.
-- Clients who upgrade will see these templates (which include all the same files).

INSERT INTO product_templates (product_tier, display_name, file_path, sort_order)
SELECT 'full_toolkit', display_name, file_path, sort_order
FROM product_templates
WHERE product_tier = 'au_compliance_core';


-- ─── Part 5: Additional Full Toolkit templates ────────────────────
-- Upload these 3 files to ethos-assets storage first, then uncomment and run.
-- Update the file_path values to match what you actually uploaded.

-- INSERT INTO product_templates (product_tier, display_name, file_path, sort_order) VALUES
--   ('full_toolkit', 'Data Governance Policy',      'templates/data-governance-policy.pdf',      10),
--   ('full_toolkit', 'AI Incident Response Plan',   'templates/ai-incident-response-plan.pdf',   11),
--   ('full_toolkit', 'Human Oversight Procedures',  'templates/human-oversight-procedures.pdf',  12);
