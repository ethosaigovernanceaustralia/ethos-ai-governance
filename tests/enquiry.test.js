'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHandler, response } = require('./helpers');

const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'dummy-service', RESEND_API_KEY: 'dummy-email', NOTIFY_EMAIL: 'admin@example.invalid' };
const general = { enquiry_type: 'general', name: 'Test Person', email: 'Person@Example.invalid', additional_notes: 'Hello' };

// Records every database call; counts come from the supplied numbers.
function fakeDb({ emailCount = 0, siteCount = 0, countError = null, insertError = null } = {}) {
  const calls = [];
  return {
    calls,
    client: { from(table) {
      const query = { filters: [],
        select() { return this; },
        eq(column, value) { this.filters.push(['eq', column, value]); return this; },
        gte(column, value) { this.filters.push(['gte', column, value]); return this; },
        then(resolve) {
          calls.push({ table, op: 'count', filters: this.filters });
          const byEmail = this.filters.some(f => f[1] === 'email');
          resolve({ count: byEmail ? emailCount : siteCount, error: countError });
        },
        insert(row) { calls.push({ table, op: 'insert', row }); return Promise.resolve({ error: insertError }); },
      };
      return query;
    } },
  };
}

function load(db, { fetch } = {}) {
  const sent = [];
  const handler = loadHandler('submit-enquiry.js', {
    env,
    mocks: { '@supabase/supabase-js': { createClient: () => db.client } },
    fetch: fetch || (async (_url, options) => { sent.push({ db: db.calls.length, body: JSON.parse(options.body) }); return { ok: true }; }),
  });
  return { handler, sent };
}

test('general contact form enquiry is saved with only stored columns, then notified', async () => {
  const db = fakeDb();
  const { handler, sent } = load(db);
  const res = response();
  await handler({ method: 'POST', body: { ...general, status: 'converted', created_at: '2000-01-01', id: 'forged' } }, res);
  assert.equal(res.code, 200);
  const insert = db.calls.find(c => c.op === 'insert');
  assert.deepEqual(Object.keys(insert.row).sort(), ['additional_notes', 'company', 'company_builds', 'email', 'enquiry_prompt', 'existing_governance', 'interested_in', 'name', 'team_size']);
  assert.equal(insert.row.email, 'person@example.invalid');
  assert.deepEqual([...insert.row.interested_in], ['general']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].db, db.calls.length, 'notification happens after the insert');
});

test('invalid enquiries are rejected before any database call', async () => {
  for (const body of [
    null, [], {}, { ...general, name: '' }, { ...general, email: 'not-an-email' },
    { ...general, name: 'x'.repeat(201) }, { ...general, additional_notes: '' },
    { ...general, interested_in: ['unknown'] }, { ...general, interested_in: 'general' },
    { ...general, name: ['array'] }, { ...general, additional_notes: 'x'.repeat(5001) },
  ]) {
    const db = fakeDb();
    const { handler, sent } = load(db);
    const res = response();
    await handler({ method: 'POST', body }, res);
    assert.equal(res.code, 400, JSON.stringify(body)?.slice(0, 60));
    assert.equal(db.calls.length, 0);
    assert.equal(sent.length, 0);
  }
});

test('per-email and site-wide limits refuse without saving or emailing', async () => {
  for (const counts of [{ emailCount: 3 }, { siteCount: 30 }]) {
    const db = fakeDb(counts);
    const { handler, sent } = load(db);
    const res = response();
    await handler({ method: 'POST', body: general }, res);
    assert.equal(res.code, 429);
    assert.ok(!db.calls.some(c => c.op === 'insert'));
    assert.equal(sent.length, 0);
  }
});

test('database failures fail closed and never send a notification', async () => {
  for (const options of [{ countError: { code: 'x' } }, { insertError: { code: '23514' } }]) {
    const db = fakeDb(options);
    const { handler, sent } = load(db);
    const res = response();
    await handler({ method: 'POST', body: general }, res);
    assert.equal(res.code, 503);
    assert.equal(sent.length, 0);
  }
});

test('notification failure still reports the saved enquiry as sent', async () => {
  const db = fakeDb();
  const { handler } = load(db, { fetch: async () => { throw new Error('network'); } });
  const res = response();
  await handler({ method: 'POST', body: general }, res);
  assert.equal(res.code, 200);
  assert.ok(db.calls.some(c => c.op === 'insert'));
});

test('missing configuration and wrong method are refused before any service access', async () => {
  const db = fakeDb();
  const handler = loadHandler('submit-enquiry.js', { env: {}, mocks: { '@supabase/supabase-js': { createClient: () => { throw new Error('should not construct'); } } } });
  const res = response();
  await handler({ method: 'POST', body: general }, res);
  assert.equal(res.code, 503);
  const res2 = response();
  await load(db).handler({ method: 'GET' }, res2);
  assert.equal(res2.code, 405);
  assert.equal(db.calls.length, 0);
});

test('retired notify-enquiry route sends nothing', async () => {
  const handler = loadHandler('notify-enquiry.js', { env });
  const res = response();
  await handler({ method: 'POST', body: general }, res);
  assert.equal(res.code, 410);
});
