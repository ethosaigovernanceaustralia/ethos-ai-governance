'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHandler, response } = require('./helpers');

const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'dummy-service', RESEND_API_KEY: 'dummy-email', NOTIFY_EMAIL: 'admin@example.invalid' };
const consents = { terms: true, privacy: true, app8: true };
const body = { name: 'Test Person', company: 'Test Co', email: 'Person@Example.invalid', consents, _hp: '' };
const consentConstants = { CONSENT_VERSION: '1.0', CONSENT_TEXT: { terms_of_service: 't', privacy_policy: 'p', app8_overseas_disclosure: 'a' } };

function fakeDb({ recentSignups = 0, invite = 'ok', failTable = null, existingProfile = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        select() { return this; }, eq() { return this; }, limit() { return this; },
        maybeSingle: async () => { calls.push(['profile-check', table]); return { data: existingProfile ? { id: 'existing-user' } : null, error: null }; },
        gte: async () => { calls.push(['count', table]); return { count: recentSignups, error: null }; },
        insert: async row => { calls.push(['insert', table, row]); return { error: failTable === table ? { code: 'x' } : null }; },
      };
    },
    auth: { admin: {
      generateLink: async ({ type, email, options }) => {
        calls.push(['invite', email, options, type]);
        if (invite === 'exists') return { data: null, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } };
        return { data: { user: { id: 'new-user', created_at: '2026-10-11T00:00:00Z', invited_at: '2026-10-11T00:00:00Z' }, properties: { action_link: 'https://example.invalid/verify?token=t' } }, error: null };
      },
      inviteUserByEmail: async () => { calls.push(['supabaseMailer']); return { data: null, error: null }; },
      deleteUser: async id => { calls.push(['delete', id]); return { error: null }; },
      createUser: async () => { calls.push(['createUser']); return { data: null, error: null }; },
    } },
  };
}

function load(db, { failSetPassword = false } = {}) {
  const sent = [];
  const handler = loadHandler('free-audit-signup.js', {
    env,
    mocks: { '@supabase/supabase-js': { createClient: () => db }, './_consent-constants': consentConstants },
    fetch: async (_url, options) => {
      const message = JSON.parse(options.body);
      if (failSetPassword && /password/i.test(message.subject)) return { ok: false, status: 500 };
      sent.push(message); return { ok: true };
    },
  });
  return { handler, sent };
}

async function call(db, payload, options) {
  const { handler, sent } = load(db, options);
  const res = response();
  await handler({ method: 'POST', headers: {}, body: payload }, res);
  return { res, sent };
}

test('sign-up invites the address and never sets a caller-chosen password', async () => {
  const db = fakeDb();
  const { res, sent } = await call(db, { ...body, password: 'attacker-chosen-password' });
  assert.equal(res.code, 200);
  assert.equal(res.body.success, true);
  const invite = db.calls.find(c => c[0] === 'invite');
  assert.equal(invite[1], 'person@example.invalid');
  assert.ok(!JSON.stringify(invite[2]).includes('attacker-chosen-password'));
  assert.equal(invite[3], 'invite');
  assert.ok(!db.calls.some(c => c[0] === 'createUser' || c[0] === 'supabaseMailer'), 'no Supabase-sent email or password');
  assert.deepEqual(db.calls.filter(c => c[0] === 'insert').map(c => c[1]), ['profiles', 'consents', 'engagements']);
  assert.equal(sent.length, 3, 'set-password, welcome and admin emails');
  assert.equal(sent[0].subject, 'Set your Ethos portal password');
  assert.ok(sent[0].html.includes('https://example.invalid/verify?token=t'));
});

test('an existing account gets the identical response and nothing is created or emailed', async () => {
  const db = fakeDb({ invite: 'exists' });
  const { res, sent } = await call(db, body);
  assert.equal(res.code, 200);
  assert.deepEqual({ ...res.body }, { success: true });
  assert.ok(!db.calls.some(c => c[0] === 'insert'));
  assert.equal(sent.length, 0);
});

test('invalid details are refused before any account work', async () => {
  for (const payload of [
    { ...body, email: 'not-an-email' }, { ...body, name: '' }, { ...body, company: 'x'.repeat(101) },
    { ...body, consents: { terms: true, privacy: true } }, { ...body, email: ['a@b.co'] },
  ]) {
    const db = fakeDb();
    const { res } = await call(db, payload);
    assert.equal(res.code, 400, JSON.stringify(payload)?.slice(0, 60));
    assert.ok(!db.calls.some(c => c[0] === 'invite'));
  }
});

test('the site-wide hourly cap refuses new sign-ups', async () => {
  const db = fakeDb({ recentSignups: 10 });
  const { res } = await call(db, body);
  assert.equal(res.code, 429);
  assert.ok(!db.calls.some(c => c[0] === 'invite'));
});

test('a failed setup step removes the new login', async () => {
  for (const table of ['profiles', 'consents', 'engagements']) {
    const db = fakeDb({ failTable: table });
    const { res } = await call(db, body);
    assert.equal(res.code, 500);
    assert.ok(db.calls.some(c => c[0] === 'delete' && c[1] === 'new-user'), table);
  }
});

test('honeypot submissions succeed silently without creating anything', async () => {
  const db = fakeDb();
  const { res } = await call(db, { ...body, _hp: 'bot' });
  assert.equal(res.code, 200);
  assert.equal(db.calls.length, 0);
});

test('if the set-password email cannot be sent the new account is removed', async () => {
  const db = fakeDb();
  const { res } = await call(db, body, { failSetPassword: true });
  assert.equal(res.code, 503);
  assert.ok(db.calls.some(c => c[0] === 'delete' && c[1] === 'new-user'));
});

test('re-inviting an existing unconfirmed login changes and deletes nothing', async () => {
  const db = fakeDb();
  db.auth.admin.generateLink = async ({ email }) => {
    db.calls.push(['invite', email]);
    return { data: { user: { id: 'existing-user', created_at: '2026-09-01T00:00:00Z', invited_at: '2026-10-11T00:00:00Z' }, properties: { action_link: 'https://example.invalid/x' } }, error: null };
  };
  const { res, sent } = await call(db, body);
  assert.equal(res.code, 200);
  assert.deepEqual({ ...res.body }, { success: true });
  assert.ok(!db.calls.some(c => c[0] === 'delete' || c[0] === 'insert'));
  assert.equal(sent.length, 0);
});

test('an existing client profile short-circuits before any account work', async () => {
  const db = fakeDb({ existingProfile: true });
  const { res, sent } = await call(db, body);
  assert.equal(res.code, 200);
  assert.deepEqual({ ...res.body }, { success: true });
  assert.ok(!db.calls.some(c => ['invite', 'insert', 'delete'].includes(c[0])));
  assert.equal(sent.length, 0);
});
