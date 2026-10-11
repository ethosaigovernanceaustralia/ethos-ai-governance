// ─── Ethos — Content Security Policy violation reports ───────────────────────
// Browsers POST here when a page breaks the report-only policy in vercel.json,
// either as a legacy report-uri body ({"csp-report": {...}}) or as a Reporting
// API batch ([{type: "csp-violation", body: {...}}]). Each report is reduced to
// non-personal fields and written to the function log, where the violations
// can be reviewed before the policy is enforced. Nothing is stored and the
// response is always 204, so a bad report never shows as an error.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BODY = 16 * 1024;
const MAX_REPORTS = 20;

// Vercel parses JSON bodies but leaves the CSP report content types
// (application/csp-report, application/reports+json) unparsed; it replays the
// raw bytes through the request's data/end events, which this reads.
function readBody(req) {
  if (req.body !== undefined && req.body !== null && !(Buffer.isBuffer(req.body) && req.body.length === 0)) {
    return Promise.resolve(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body);
  }
  if (typeof req.on !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    let raw = '', done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    req.on('data', chunk => { raw += chunk; if (raw.length > MAX_BODY) finish(null); });
    req.on('end', () => finish(raw));
    req.on('error', () => finish(null));
  });
}

// Page addresses lose their query and fragment (reset links carry tokens there);
// blocked resources keep only their origin or the CSP keyword (inline, eval).
function pagePath(value) {
  try { return new URL(String(value)).pathname.slice(0, 200); } catch { return null; }
}
function blockedSource(value) {
  const v = String(value || '');
  if (!v) return null;
  try { return new URL(v).origin; } catch { return v.slice(0, 40); }
}
const text = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));

function summarise(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    page: pagePath(r['document-uri'] ?? r.documentURL),
    directive: text(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'], 60),
    blocked: blockedSource(r['blocked-uri'] ?? r.blockedURL),
    source: pagePath(r['source-file'] ?? r.sourceFile),
    line: Number.isFinite(Number(r['line-number'] ?? r.lineNumber)) ? Number(r['line-number'] ?? r.lineNumber) : null,
    sample: text(r['script-sample'] ?? r.sample, 40),
    disposition: text(r.disposition, 10),
  };
}

function extractReports(body) {
  if (Array.isArray(body)) {
    return body.slice(0, MAX_REPORTS)
      .filter(item => item && item.type === 'csp-violation')
      .map(item => summarise(item.body));
  }
  if (body && typeof body === 'object' && body['csp-report']) return [summarise(body['csp-report'])];
  return [];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    let body = await readBody(req);
    if (typeof body === 'string') {
      if (body.length > MAX_BODY) body = null;
      else { try { body = JSON.parse(body); } catch { body = null; } }
    }
    for (const report of extractReports(body)) {
      if (report && report.directive) console.warn('[csp-report]', JSON.stringify(report));
    }
  } catch {
    // A malformed report is not worth an error response.
  }
  return res.status(204).send('');
};
