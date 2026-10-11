'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadHandler, response, root } = require('./helpers');

const A = '00000000-0000-4000-a000-00000000000a';   // client A
const B = '00000000-0000-4000-a000-00000000000b';   // client B
const M = '00000000-0000-4000-a000-0000000000ad';   // admin
const EA = '00000000-0000-4000-b000-00000000000a', EB = '00000000-0000-4000-b000-00000000000b';
const payload = '<img/src=x/onerror=alert(1)>';
const now = () => new Date().toISOString();
const old = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'dummy-service', RESEND_API_KEY: 'dummy-email', NOTIFY_EMAIL: 'admin@example.invalid' };

function seed() {
  return {
    profiles: [
      { id: A, role: 'client', full_name: `Client ${payload}`, email: 'a@example.invalid', notification_prefs: {} },
      { id: B, role: 'client', full_name: 'Client B', email: 'b@example.invalid', notification_prefs: { new_message: false } },
      { id: M, role: 'admin', full_name: 'Admin', email: 'admin@example.invalid', notification_prefs: {} },
    ],
    engagements: [
      { id: EA, client_id: A, engagement_type: 'free_audit', progress_stage: 'under_review', updated_at: now() },
      { id: EB, client_id: B, engagement_type: 'free_audit', progress_stage: null, updated_at: now() },
    ],
    messages: [
      { id: '00000000-0000-4000-d000-000000000001', client_id: A, sender_id: A, sender_role: 'client', body: `Hi ${payload}`, document_id: null, created_at: now() },
      { id: '00000000-0000-4000-d000-000000000002', client_id: A, sender_id: M, sender_role: 'admin', body: 'Reply', document_id: null, created_at: now() },
      { id: '00000000-0000-4000-d000-000000000003', client_id: B, sender_id: M, sender_role: 'admin', body: 'For B', document_id: null, created_at: now() },
      { id: '00000000-0000-4000-d000-000000000004', client_id: A, sender_id: A, sender_role: 'client', body: 'Old', document_id: null, created_at: old() },
    ],
    documents: [
      { id: '00000000-0000-4000-c000-00000000000a', engagement_id: EA, uploaded_by: A, document_type: 'client_upload', file_name: 'a.pdf', created_at: now() },
      { id: '00000000-0000-4000-c000-00000000000b', engagement_id: EA, uploaded_by: M, document_type: 'ethos_deliverable', file_name: `${payload}.pdf`, created_at: now() },
      { id: '00000000-0000-4000-c000-00000000000c', engagement_id: EB, uploaded_by: B, document_type: 'client_upload', file_name: 'b.pdf', created_at: now() },
      { id: '00000000-0000-4000-c000-00000000000d', engagement_id: EA, uploaded_by: A, document_type: 'client_upload', file_name: 'a2.pdf', created_at: now() },
    ],
    action_items: [
      { id: '00000000-0000-4000-e000-000000000001', client_id: A, title: `Task ${payload}`, status: 'complete', assigned_to: 'client', due_date: '2026-11-01', created_at: now() },
      { id: '00000000-0000-4000-e000-000000000002', client_id: A, title: 'Pending', status: 'pending', assigned_to: 'client', due_date: null, created_at: now() },
    ],
    notification_log: [],
  };
}

function fakeDb(tables, users) {
  return {
    auth: { getUser: async token => users[token] ? { data: { user: { id: users[token] } }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
    from(table) {
      const filters = [];
      const rows = () => tables[table].filter(r => filters.every(([op, c, v]) => op === 'eq' ? r[c] === v : r[c] >= v));
      return {
        select() { return this; },
        eq(c, v) { filters.push(['eq', c, v]); return this; },
        gte(c, v) { filters.push(['gte', c, v]); return this; },
        maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
        then(resolve) { resolve({ count: rows().length, error: null }); },
        insert: async row => {
          if (tables[table].some(r => r.event === row.event && r.ref_key === row.ref_key)) return { error: { code: '23505' } };
          tables[table].push({ ...row, created_at: now() }); return { error: null };
        },
      };
    },
  };
}

function setup({ tables = seed(), envOverride = env } = {}) {
  const sent = [];
  const db = fakeDb(tables, { 'tok-a': A, 'tok-b': B, 'tok-m': M });
  const handler = loadHandler('send-notification.js', {
    env: envOverride,
    mocks: { '@supabase/supabase-js': { createClient: () => db } },
    fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; },
  });
  const call = async (token, body) => {
    const res = response();
    await handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
    return res;
  };
  return { call, sent, tables };
}

test('client events notify the admin once, with content read from the record and escaped', async () => {
  const { call, sent } = setup();
  const res = await call('tok-a', { event: 'new_message_from_client', clientId: A, ref: '00000000-0000-4000-d000-000000000001' });
  assert.equal(res.code, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual([...sent[0].to], ['admin@example.invalid']);
  assert.ok(!sent[0].html.includes(payload));
  assert.ok(sent[0].html.includes('&lt;img'));
  const again = await call('tok-a', { event: 'new_message_from_client', clientId: A, ref: '00000000-0000-4000-d000-000000000001' });
  assert.equal(again.code, 200);
  assert.equal(sent.length, 1, 'replaying the same record sends nothing');
});

test('caller and event matrix is enforced', async () => {
  const cases = [
    ['tok-a', { event: 'new_message_from_admin', clientId: A, ref: '00000000-0000-4000-d000-000000000002' }, 403, 'client raising an admin event'],
    ['tok-a', { event: 'new_message_from_client', clientId: B, ref: '00000000-0000-4000-d000-000000000001' }, 403, 'client acting for another client'],
    ['tok-b', { event: 'document_uploaded_by_client', clientId: B, ref: '00000000-0000-4000-c000-00000000000a' }, 404, 'client citing another client document'],
    ['tok-m', { event: 'new_message_from_client', clientId: A, ref: '00000000-0000-4000-d000-000000000001' }, 403, 'admin raising a client event'],
    ['tok-m', { event: 'new_message_from_admin', clientId: A, ref: '00000000-0000-4000-d000-000000000003' }, 404, 'admin message from another thread'],
    ['tok-m', { event: 'new_message_from_admin', clientId: M, ref: '00000000-0000-4000-d000-000000000002' }, 404, 'admin as the recipient client'],
    ['tok-a', { event: 'new_message_from_client', clientId: A, ref: '00000000-0000-4000-d000-000000000004' }, 404, 'stale record'],
    ['tok-a', { event: 'action_item_completed', clientId: A, ref: '00000000-0000-4000-e000-000000000002' }, 404, 'task not complete'],
    ['tok-m', { event: 'document_shared', clientId: A, ref: '00000000-0000-4000-c000-00000000000a' }, 404, 'client upload is not a shared deliverable'],
    ['bad', { event: 'new_message_from_client', clientId: A, ref: '00000000-0000-4000-d000-000000000001' }, 401, 'invalid token'],
    [null, { event: 'new_message_from_client', clientId: A, ref: '00000000-0000-4000-d000-000000000001' }, 401, 'no token'],
    ['tok-a', { event: 'made_up', clientId: A, ref: '00000000-0000-4000-d000-000000000001' }, 400, 'unknown event'],
    ['tok-a', { event: 'new_message_from_client', clientId: A, ref: 'not-a-uuid' }, 400, 'malformed ref'],
    ['tok-a', { event: 'new_message_from_client', clientId: A, metadata: { preview: 'x' } }, 400, 'old metadata-only request'],
  ];
  for (const [token, body, code, label] of cases) {
    const { call, sent } = setup();
    const res = await call(token, body);
    assert.equal(res.code, code, label);
    assert.equal(sent.length, 0, label);
  }
});

test('admin events reach the client, respect preferences and use stored values', async () => {
  const { call, sent } = setup();
  assert.equal((await call('tok-m', { event: 'document_shared', clientId: A, ref: '00000000-0000-4000-c000-00000000000b' })).code, 200);
  assert.equal((await call('tok-m', { event: 'action_item_created', clientId: A, ref: '00000000-0000-4000-e000-000000000001' })).code, 200);
  assert.equal((await call('tok-m', { event: 'progress_updated', clientId: A, ref: EA })).code, 200);
  assert.equal(sent.length, 3);
  assert.ok(sent.every(s => s.to[0] === 'a@example.invalid' && !s.html.includes(payload)));
  assert.ok(sent[2].html.includes('Under Review'));
  const muted = await call('tok-m', { event: 'new_message_from_admin', clientId: B, ref: '00000000-0000-4000-d000-000000000003' });
  assert.equal(muted.code, 200);
  assert.equal(sent.length, 3, 'client B turned off message emails');
  assert.ok(sent.every(s => !/—/.test(s.subject)), 'no em dashes in subjects');
});

test('upload notifications are debounced per client on the server', async () => {
  const { call, sent } = setup();
  await call('tok-a', { event: 'document_uploaded_by_client', clientId: A, ref: '00000000-0000-4000-c000-00000000000a' });
  await call('tok-a', { event: 'document_uploaded_by_client', clientId: A, ref: '00000000-0000-4000-c000-00000000000d' });
  assert.equal(sent.length, 1);
});

test('missing configuration fails closed before any service access', async () => {
  const handler = loadHandler('send-notification.js', { env: { RESEND_API_KEY: 'dummy-email', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'legacy-name-only' },
    mocks: { '@supabase/supabase-js': { createClient: () => { throw new Error('should not construct'); } } } });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer tok-a' }, body: {} }, res);
  assert.equal(res.code, 503);
});

test('server progress labels match the portal milestones', () => {
  const context = {};
  const source = fs.readFileSync(path.join(root, 'portal', 'portal.js'), 'utf8');
  const block = source.slice(source.indexOf('const PROGRESS_MILESTONES'), source.indexOf('function getProgressStagesForType'));
  vm.runInNewContext(block.replace('const PROGRESS_MILESTONES', 'this.PROGRESS_MILESTONES'), context);
  const { PROGRESS_LABELS } = loadHandler('../lib/progress-stages.js');
  for (const [type, stages] of Object.entries(context.PROGRESS_MILESTONES)) {
    assert.deepEqual(Object.fromEntries(stages.map(s => [s.id, s.label])), { ...PROGRESS_LABELS[type] }, type);
  }
  assert.deepEqual(Object.keys(context.PROGRESS_MILESTONES).sort(), Object.keys(PROGRESS_LABELS).sort());
});
