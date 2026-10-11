'use strict';

// Server copy of PROGRESS_MILESTONES in portal/portal.js (labels only).
// tests/notification.test.js fails if the two drift apart.
const PROGRESS_LABELS = {
  iso_pathway: {
    gap_analysis: 'Gap Analysis',
    aims_documentation: 'AIMS Documentation',
    internal_audit_prep: 'Internal Audit Prep',
    cert_readiness_review: 'Cert. Readiness',
    certification_ready: 'Certification Ready',
  },
  free_audit: {
    questionnaire_submitted: 'Questionnaire Submitted',
    under_review: 'Under Review',
    report_delivered: 'Report Delivered',
  },
  full_toolkit: {
    governance_policy: 'Governance Policy',
    ai_inventory: 'AI System Inventory',
    risk_register: 'Risk Register',
    data_governance: 'Data Governance',
    incident_response: 'Incident Response',
    procurement_readiness: 'Procurement Readiness',
    stakeholder_comms: 'Stakeholder Comms',
    ongoing_governance: 'Ongoing Governance',
  },
};

function stageLabel(engagementType, stage) {
  const labels = Object.hasOwn(PROGRESS_LABELS, engagementType) ? PROGRESS_LABELS[engagementType] : {};
  return Object.hasOwn(labels, stage) ? labels[stage] : String(stage).replace(/_/g, ' ');
}

module.exports = { PROGRESS_LABELS, stageLabel };
