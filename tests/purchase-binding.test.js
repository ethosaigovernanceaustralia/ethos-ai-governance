'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHandler } = require('./helpers');

const ID = '00000000-0000-4000-a000-00000000000a';

const sent = [];
function load() {
  sent.length = 0;
  return loadHandler('stripe-webhook.js', {
    env: { RESEND_API_KEY: 'dummy-email' },
    mocks: { stripe: {}, '@supabase/supabase-js': {}, 'pdf-lib': {}, './_consent-constants': {} },
    fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; },
    append: '\nmodule.exports = findOrCreateClient;',
  });
}

// Fake service client: profiles rows, auth users, and a record of auth admin calls.
function fakeSupabase({ profiles = [], users = {}, lookupError = null, invite = 'ok', profileInsertError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(c, v) { filters.push([c, v]); return this; },
        limit: async () => ({ data: lookupError ? null : profiles.filter(r => filters.every(([c, v]) => r[c] === v)), error: lookupError }),
        insert: async row => { calls.push(['profile-insert', row]); if (!profileInsertError) profiles.push(row); return { error: profileInsertError }; },
      };
    },
    auth: {
      admin: {
        generateLink: async ({ type, email }) => {
          if (type === 'invite') {
            calls.push(['invite', email]);
            if (invite === 'exists') return { data: null, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } };
            if (invite === 'fail') return { data: null, error: { message: 'boom' } };
            users[ID] = { id: ID, email, email_confirmed_at: null, created_at: '2026-10-11T00:00:00Z', invited_at: '2026-10-11T00:00:00Z' };
            return { data: { user: users[ID], properties: { action_link: 'https://example.invalid/invite' } }, error: null };
          }
          calls.push([type === 'recovery' ? 'reset' : 'generateLink', email]);
          return { data: { user: Object.values(users).find(u => u.email === email), properties: { action_link: `https://example.invalid/${type}` } }, error: null };
        },
        getUserById: async id => users[id] ? { data: { user: users[id] }, error: null } : { data: { user: null }, error: { message: 'missing' } },
        updateUserById: async (id, attrs) => { calls.push(['rotate', id, typeof attrs.password]); return { error: null }; },
      },
    },
  };
}

test('new buyer is invited and a profile created with the normalised email', async () => {
  const db = fakeSupabase();
  const result = await load()(db, '  Buyer@Example.INVALID ', 'Buyer');
  assert.equal(result.clientId, ID);
  assert.equal(result.isNewClient, true);
  assert.deepEqual(db.calls.map(c => c[0]), ['invite', 'profile-insert']);
  assert.equal(db.calls[0][1], 'buyer@example.invalid');
  assert.equal(db.calls[1][1].email, 'buyer@example.invalid');
  assert.equal(sent.length, 1, 'branded set-password email sent through Resend');
  assert.ok(sent[0].html.includes('https://example.invalid/invite'));
});

test('verified existing account is matched without touching its password', async () => {
  const db = fakeSupabase({
    profiles: [{ id: ID, email: 'buyer@example.invalid' }],
    users: { [ID]: { id: ID, email: 'buyer@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z' } },
  });
  const result = await load()(db, 'buyer@example.invalid', 'Buyer');
  assert.equal(result.clientId, ID);
  assert.deepEqual(db.calls, []);
});

test('unverified existing account has its password replaced and the buyer is sent a set-password link', async () => {
  const db = fakeSupabase({
    profiles: [{ id: ID, email: 'buyer@example.invalid' }],
    users: { [ID]: { id: ID, email: 'buyer@example.invalid', email_confirmed_at: null } },
  });
  const result = await load()(db, 'buyer@example.invalid', 'Buyer');
  assert.equal(result.clientId, ID);
  assert.deepEqual(db.calls.map(c => c[0]), ['rotate', 'reset']);
  assert.equal(db.calls[0][2], 'string');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].html.includes('https://example.invalid/recovery'));
});

test('ambiguous, mismatched or unreadable matches fail safely without granting', async () => {
  const cases = [
    fakeSupabase({ profiles: [{ id: ID, email: 'buyer@example.invalid' }, { id: 'other', email: 'buyer@example.invalid' }] }),
    fakeSupabase({ profiles: [{ id: ID, email: 'buyer@example.invalid' }], users: { [ID]: { id: ID, email: 'someone-else@example.invalid', email_confirmed_at: 'x' } } }),
    fakeSupabase({ lookupError: { message: 'db down' } }),
    fakeSupabase({ invite: 'fail' }),
  ];
  for (const db of cases) {
    await assert.rejects(load()(db, 'buyer@example.invalid', 'Buyer'));
    assert.ok(!db.calls.some(c => c[0] === 'rotate'));
  }
});

test('retry after an interrupted creation recovers the existing login instead of wedging', async () => {
  const db = fakeSupabase({ invite: 'exists', users: { [ID]: { id: ID, email: 'buyer@example.invalid', email_confirmed_at: null } } });
  const result = await load()(db, 'buyer@example.invalid', 'Buyer');
  assert.equal(result.clientId, ID);
  assert.deepEqual(db.calls.map(c => c[0]), ['invite', 'generateLink', 'profile-insert', 'rotate', 'reset']);
});

test('a concurrent duplicate profile insert is tolerated', async () => {
  const db = fakeSupabase({ profileInsertError: { code: '23505' } });
  const result = await load()(db, 'buyer@example.invalid', 'Buyer');
  assert.equal(result.clientId, ID);
});
