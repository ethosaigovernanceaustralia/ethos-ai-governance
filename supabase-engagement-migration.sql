-- ============================================================
-- ETHOS — Add au_compliance_core engagement type
-- Run in Supabase Dashboard > SQL Editor
-- ============================================================

ALTER TABLE engagements DROP CONSTRAINT engagements_engagement_type_check;

ALTER TABLE engagements ADD CONSTRAINT engagements_engagement_type_check
  CHECK (engagement_type IN (
    'free_audit',
    'toolkit_self_service',
    'toolkit_consulting',
    'retainer',
    'iso_pathway',
    'au_compliance_core'
  ));
