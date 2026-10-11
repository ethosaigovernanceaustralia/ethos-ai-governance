'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHandler } = require('./helpers');

test('HTTP email helper retains message and recipient without using the SDK', async () => {
  let sent;
  const { sendEmail } = loadHandler('../lib/email.js', {
    env: { RESEND_API_KEY: 'dummy-email-key' },
    fetch: async (url, options) => { sent = { url, ...options }; return { ok: true }; },
  });
  const message = { to: 'synthetic@example.invalid', from: 'test@example.invalid', subject: 'Test', html: 'Test' };
  await sendEmail(message);
  assert.deepEqual(JSON.parse(sent.body), message);
  assert.equal(sent.headers.Authorization, 'Bearer dummy-email-key');
  assert.ok(sent.signal);
});

test('HTTP email helper rejects missing credentials and provider failure without exposing response content', async () => {
  const unconfigured = loadHandler('../lib/email.js');
  await assert.rejects(unconfigured.sendEmail({}), /not configured/);
  const configured = loadHandler('../lib/email.js', {
    env: { RESEND_API_KEY: 'dummy-email-key' },
    fetch: async () => ({ ok: false, status: 429, text() { assert.fail('Do not read provider response'); } }),
  });
  await assert.rejects(configured.sendEmail({}), /Email delivery failed \(429\)/);
});
