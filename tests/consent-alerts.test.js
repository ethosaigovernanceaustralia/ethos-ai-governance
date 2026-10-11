'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadHandler, response, root } = require('./helpers');

const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'dummy-service' };
const constants = { CONSENT_VERSION: '2.0', CONSENT_TEXT: { terms_of_service: 't', privacy_policy: 'p', app8_overseas_disclosure: 'a' } };

function consentDb(held, filters) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    from() {
      const q = { select() { return q; }, eq(c, v) { filters.push([c, v]); return q; },
        then(resolve) { resolve({ data: held.map(t => ({ consent_type: t })), error: null }); },
        insert: async () => ({ error: null }) };
      return q;
    },
  };
}

test('consent check counts only the current version', async () => {
  const filters = [];
  const handler = loadHandler('record-consents.js', { env, mocks: { '@supabase/supabase-js': { createClient: () => consentDb([], filters) }, './_consent-constants': constants } });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer t' } }, res);
  assert.equal(res.code, 200);
  assert.ok(filters.some(([c, v]) => c === 'version' && v === '2.0'));
  assert.equal(res.body.version, '2.0');
});

test('dashboard consent gate fails closed', () => {
  const html = fs.readFileSync(path.join(root, 'portal', 'dashboard-page.js'), 'utf8');
  const gate = html.slice(html.indexOf('async function needsConsentGate'), html.indexOf('function showConsentModal'));
  assert.ok(!/return false;\s*\n\s*}\s*$/.test(gate.trim()) && !gate.includes('Fail open'));
  assert.equal((gate.match(/return true;/g) || []).length, 2);
});

test('a failed non-critical webhook step emails the admin without leaking markup', async () => {
  const sent = [];
  const tryStep = loadHandler('stripe-webhook.js', {
    env: { RESEND_API_KEY: 'dummy-email', NOTIFY_EMAIL: 'admin@example.invalid' },
    mocks: { stripe: {}, '@supabase/supabase-js': {}, 'pdf-lib': {}, './_consent-constants': {} },
    fetch: async (_u, o) => { sent.push(JSON.parse(o.body)); return { ok: true }; },
    append: '\nmodule.exports = tryStep;',
  });
  await tryStep('invoice<b>', async () => { throw new Error('<script>x</script>'); });
  assert.equal(sent.length, 1);
  assert.deepEqual([...sent[0].to], ['admin@example.invalid']);
  assert.ok(!sent[0].html.includes('<script>') && !sent[0].html.includes('invoice<b>'));
  sent.length = 0;
  await tryStep('ok', async () => {});
  assert.equal(sent.length, 0);
});
