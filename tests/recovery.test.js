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
        select() { return table === 'email_suppressions' ? Promise.resolve({ data: [{ email: 'suppressed@example.invalid' }] }) : this; },
        not() { return this; }, is() { return this; }, lt: async () => ({ data: rows }),
        update() { return this; }, eq: async () => ({ error: null }),
      }) }) },
    },
    fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; },
  });
  const res = response(); await handler({ method: 'GET', headers: { authorization: 'Bearer dummy-cron' } }, res);
  assert.equal(res.code, 200); assert.equal(sent.length, 1); assert.equal(res.body.suppressed, 1);
  assert.ok(sent[0].html.includes('&lt;img')); assert.ok(!sent[0].html.includes('<img'));
});
