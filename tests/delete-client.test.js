'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHandler, response } = require('./helpers');

const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'dummy-service' };
const CLIENT = '00000000-0000-4000-a000-00000000000a';

function fakeDb({ callerRole = 'admin', client = { id: CLIENT, role: 'client', deleted_at: '2026-10-01' }, invoices = 0, purchases = 0, files = [] } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      getUser: async token => token === 'good' ? { data: { user: { id: 'caller' } }, error: null } : { data: { user: null }, error: { message: 'bad' } },
      admin: { deleteUser: async id => { calls.push(['deleteUser', id]); return { error: null }; } },
    },
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(c, v) { filters[c] = v; return this; },
        in() { return this; },
        delete() { calls.push(['delete', table]); return this; },
        maybeSingle: async () => ({ data: filters.id === 'caller' ? { role: callerRole } : client, error: null }),
        then(resolve) {
          if (table === 'invoices') return resolve({ count: invoices, error: null });
          if (table === 'product_access') return resolve({ count: purchases, error: null });
          if (table === 'engagements') return resolve({ data: [{ id: 'eng-1' }], error: null });
          return resolve({ error: null });
        },
      };
    },
    storage: { from: () => ({
      list: async () => ({ data: files.splice(0, 100), error: null }),
      remove: async names => { calls.push(['remove', names.length]); return { error: null }; },
    }) },
  };
}

async function call(db, { token = 'good', body = { clientId: CLIENT } } = {}) {
  const handler = loadHandler('delete-client.js', { env, mocks: { '@supabase/supabase-js': { createClient: () => db } } });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('refusals delete nothing', async () => {
  const cases = [
    [{ token: 'bad' }, {}, 401],
    [{}, { callerRole: 'client' }, 403],
    [{ body: { clientId: 'nope' } }, {}, 400],
    [{}, { client: { id: CLIENT, role: 'client', deleted_at: null } }, 409],
    [{}, { client: { id: CLIENT, role: 'admin', deleted_at: '2026-10-01' } }, 404],
    [{}, { invoices: 1 }, 409],
    [{}, { purchases: 1 }, 409],
  ];
  for (const [opts, dbOpts, code] of cases) {
    const db = fakeDb(dbOpts);
    const res = await call(db, opts);
    assert.equal(res.code, code, JSON.stringify([opts, dbOpts]));
    assert.equal(db.calls.length, 0);
  }
});

test('a binned client without financial records is removed: files, rows, then login', async () => {
  const db = fakeDb({ files: [{ name: 'a.pdf' }, { name: 'b.pdf' }] });
  const res = await call(db);
  assert.equal(res.code, 200);
  assert.equal(res.body.removedFiles, 2);
  const order = db.calls.map(c => c[0]);
  assert.equal(order[0], 'remove');
  assert.equal(order.at(-1), 'deleteUser');
  assert.ok(order.includes('delete'));
});
