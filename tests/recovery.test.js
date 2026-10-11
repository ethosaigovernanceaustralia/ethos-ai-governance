'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHandler, response } = require('./helpers');

for (const secret of [undefined, '', '   ']) {
  test(`cron denies missing/blank secret ${JSON.stringify(secret)} before any service access`, async () => {
    const handler = loadHandler('send-recovery-emails.js', {
      env: { CRON_SECRET: secret },
      mocks: { '@supabase/supabase-js': { createClient() { assert.fail('Database called'); } }, './unsubscribe': {} },
    });
    const res = response();
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 503);
  });
}
for (const authorization of [undefined, 'Bearer wrong', ['Bearer dummy-cron']]) {
  test(`cron rejects invalid authorization ${JSON.stringify(authorization)}`, async () => {
    const handler = loadHandler('send-recovery-emails.js', {
      env: { CRON_SECRET: 'dummy-cron' },
      mocks: { '@supabase/supabase-js': { createClient() { assert.fail('Database called'); } }, './unsubscribe': {} },
    });
    const res = response();
    await handler({ method: 'GET', headers: { authorization } }, res);
    assert.equal(res.code, 401);
  });
}
test('authorised cron with missing service configuration does not access services', async () => {
  const handler = loadHandler('send-recovery-emails.js', {
    env: { CRON_SECRET: 'dummy-cron' },
    mocks: { '@supabase/supabase-js': { createClient() { assert.fail('Database called'); } }, './unsubscribe': {} },
  });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer dummy-cron' } }, res);
  assert.equal(res.code, 503);
});
test('authorised, configured cron can complete with no eligible rows', async () => {
  let calls = 0;
  const query = { select() { return this; }, not() { return this; }, is() { return this; }, lt: async () => ({ data: [], error: null }) };
  const handler = loadHandler('send-recovery-emails.js', {
    env: { CRON_SECRET: 'dummy-cron', SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'dummy-key', RESEND_API_KEY: 'dummy-email' },
    mocks: { '@supabase/supabase-js': { createClient() { calls++; return { from: () => query }; } }, './unsubscribe': {} },
  });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer dummy-cron' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.sent, 0);
  assert.equal(calls, 1);
});

test('recovery email escapes product text and skips a suppressed recipient', async () => {
  const sent = [];
  const rows = [
    { id: 'one', customer_email: 'buyer@example.invalid', product_tier: '<img/src=x/onerror=alert(1)>' },
    { id: 'two', customer_email: 'suppressed@example.invalid', product_tier: 'full_toolkit' },
  ];
  const handler = loadHandler('send-recovery-emails.js', {
    env: { CRON_SECRET: 'dummy-cron', SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'dummy-key', RESEND_API_KEY: 'dummy-email' },
    mocks: {
      './unsubscribe': { unsubscribeToken: () => 'a'.repeat(32) },
      '@supabase/supabase-js': { createClient: () => ({ from: table => ({
        select(cols) {
          if (table === 'email_suppressions') return Promise.resolve({ data: [{ email: 'suppressed@example.invalid' }] });
          return cols === 'id' ? Promise.resolve({ data: [{ id: 'claimed' }], error: null }) : this;
        },
        not() { return this; }, is() { return this; }, lt: async () => ({ data: rows }),
        update() { return this; }, eq() { return this; },
      }) }) },
    },
    fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; },
  });
  const res = response(); await handler({ method: 'GET', headers: { authorization: 'Bearer dummy-cron' } }, res);
  assert.equal(res.code, 200); assert.equal(sent.length, 1); assert.equal(res.body.suppressed, 1);
  assert.ok(sent[0].html.includes('&lt;img')); assert.ok(!sent[0].html.includes('<img'));
});

// A small in-memory abandoned_checkouts table that honours the claim's
// conditional update, so overlapping runs behave as they would in Postgres.
function fakeDb(rows) {
  const table = new Map(rows.map(r => [r.id, { ...r, recovery_email_sent_at: null }]));
  return {
    table,
    from(name) {
      if (name === 'email_suppressions') return { select: async () => ({ data: [] }) };
      const q = { filters: [], patch: null };
      const api = {
        select(cols) {
          if (q.patch) {
            const hit = [...table.values()].filter(r => q.filters.every(f => f(r)));
            hit.forEach(r => Object.assign(r, q.patch));
            return Promise.resolve({ data: hit.map(r => ({ id: r.id })), error: null });
          }
          return api;
        },
        update(patch) { q.patch = patch; return api; },
        eq(col, v) { q.filters.push(r => r[col] === v); return api; },
        is(col, v) { q.filters.push(r => r[col] === v); return api; },
        not() { return api; },
        lt: async () => ({ data: [...table.values()].filter(r => r.recovery_email_sent_at === null).map(r => ({ ...r })), error: null }),
        then(resolve) { // a plain update without .select() (the release)
          [...table.values()].filter(r => q.filters.every(f => f(r))).forEach(r => Object.assign(r, q.patch));
          return resolve({ error: null });
        },
      };
      return api;
    },
  };
}
const ENV = { CRON_SECRET: 'dummy-cron', SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'dummy-key', RESEND_API_KEY: 'dummy-email' };
const AUTH = { method: 'GET', headers: { authorization: 'Bearer dummy-cron' } };
const load = (db, fetch) => loadHandler('send-recovery-emails.js', {
  env: ENV, fetch,
  mocks: { './unsubscribe': { unsubscribeToken: () => 'a'.repeat(32) }, '@supabase/supabase-js': { createClient: () => db } },
});

test('overlapping runs email each abandoned checkout once', { timeout: 3000 }, async () => {
  const db = fakeDb([{ id: 'c1', customer_email: 'a@example.invalid', product_tier: 'full_toolkit' }]);
  const sent = [];
  let releaseFirst;
  const gate = new Promise(r => { releaseFirst = r; });
  const fetch = async (_url, options) => { sent.push(options.headers['Idempotency-Key']); await gate; return { ok: true }; };
  const first = load(db, fetch)(AUTH, response());
  await new Promise(r => setTimeout(r, 5)); // first run has claimed and is mid-send
  const res2 = response();
  await load(db, fetch)(AUTH, res2);
  releaseFirst();
  await first;
  assert.deepEqual(sent, ['recovery-c1']);
  assert.equal(res2.body.sent, 0);
  assert.ok(db.table.get('c1').recovery_email_sent_at);
});

test('a failed or interrupted send releases the claim for the next run', async () => {
  for (const fetch of [async () => ({ ok: false, status: 500 }), async () => { throw new Error('network'); }]) {
    const db = fakeDb([{ id: 'c2', customer_email: 'b@example.invalid', product_tier: 'au_compliance_core' }]);
    const res = response();
    await load(db, fetch)(AUTH, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.sent, 0);
    assert.equal(db.table.get('c2').recovery_email_sent_at, null);
  }
});
