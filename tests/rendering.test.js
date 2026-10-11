'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { loadHandler, response, root } = require('./helpers');
const { escapeHtml } = require('../lib/html');
const payload = '<img/src=x/onerror=alert(1)>';

test('HTML helper encodes markup, both quotes and ampersands', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});
test('enquiry email encodes every free-text field and unknown labels', () => {
  const { enquiryEmailHtml } = loadHandler('../lib/enquiry.js');
  const html = enquiryEmailHtml({ name: payload, company: payload, email: `a\"${payload}@example.invalid`, company_builds: payload, enquiry_prompt: payload, team_size: payload, interested_in: [payload], existing_governance: payload, additional_notes: payload });
  assert.ok(!html.includes(payload));
  assert.ok(html.includes('&quot;&lt;img'));
  assert.equal((html.match(/&lt;img/g) || []).length, 10);
});
test('webhook invoice email treats buyer name and product as text', async () => {
  let sent;
  const helper = loadHandler('stripe-webhook.js', {
    env: { RESEND_API_KEY: 'dummy-email' },
    mocks: { stripe: {}, '@supabase/supabase-js': {}, 'pdf-lib': {}, './_consent-constants': {} },
    append: '\nmodule.exports = sendInvoiceEmail;',
    fetch: async (_url, options) => { sent = JSON.parse(options.body); return { ok: true }; },
  });
  await helper({ email: 'buyer@example.invalid', name: payload, invoiceNumber: 'TEST-1', productName: payload, pdfBytes: Buffer.from('dummy') });
  assert.ok(!sent.html.includes(payload));
  assert.equal((sent.html.match(/&lt;img/g) || []).length, 3);
});

test('resend invoice renders stored buyer and product text safely', async () => {
  let sent;
  const invoice = { id: 'test-invoice', file_path: 'test.pdf', product_tier: payload, invoice_number: 'TEST-1', profiles: { full_name: payload, email: 'buyer@example.invalid' } };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'dummy-admin' } } }) },
    from(table) { return {
      select() { return this; }, eq() { return this; }, update() { return this; },
      single: async () => ({ data: table === 'profiles' ? { role: 'admin' } : invoice }),
    }; },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.example.invalid/dummy' } }) }) },
  };
  const handler = loadHandler('resend-invoice.js', {
    env: { RESEND_API_KEY: 'dummy-email' }, mocks: { '@supabase/supabase-js': { createClient: () => db } },
    fetch: async (_url, options) => {
      if (!options) return { ok: true, arrayBuffer: async () => Buffer.from('dummy PDF') };
      sent = JSON.parse(options.body); return { ok: true };
    },
  });
  const res = response(); await handler({ method: 'POST', body: { invoiceId: 'test-invoice' }, headers: { authorization: 'Bearer dummy-admin' } }, res);
  assert.equal(res.code, 200); assert.ok(!sent.html.includes(payload));
  assert.equal((sent.html.match(/&lt;img/g) || []).length, 2);
});

test('unsubscribe rejects array, object, long and non-ASCII token input without database calls', async () => {
  const handler = loadHandler('unsubscribe.js', { mocks: { '@supabase/supabase-js': { createClient() { assert.fail('Database called'); } } } });
  for (const query of [{ email: ['a@example.invalid'], token: 'a'.repeat(32) }, { email: {}, token: 'a'.repeat(32) }, { email: 'a'.repeat(255), token: 'a'.repeat(32) }, { email: 'a@example.invalid', token: 'é'.repeat(32) }, { email: 'a@example.invalid', token: ['a'.repeat(32)] }]) {
    const res = response(); await handler({ method: 'GET', query }, res); assert.equal(res.code, 400);
  }
});
test('signed unsubscribe saves normalised email and encodes reflected markup', async () => {
  let saved;
  const email = `${payload}@example.invalid`;
  const key = 'dummy-signing-key';
  const token = crypto.createHmac('sha256', key).update(email.toLowerCase()).digest('hex').slice(0, 32);
  const handler = loadHandler('unsubscribe.js', {
    env: { SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: key },
    mocks: { '@supabase/supabase-js': { createClient: () => ({ from: () => ({ upsert: async row => { saved = row; return { error: null }; } }) }) } },
  });
  const res = response(); await handler({ method: 'GET', query: { email, token } }, res);
  assert.equal(res.code, 200); assert.equal(saved.email, email.toLowerCase());
  assert.ok(!res.body.includes(payload)); assert.ok(res.body.includes('&lt;img'));
});

test('admin enquiry list and detail encode unknown prompt, interest and status markup', async () => {
  const source = fs.readFileSync(path.join(root, 'portal/admin.html'), 'utf8');
  const functions = source.slice(source.indexOf('async function loadEnquiries()'), source.indexOf('async function handleEnquiryStatusChange('));
  const nodes = new Map();
  const context = {
    _allEnquiries: [], _selectedEnquiry: null,
    getEnquiries: async () => [{ id: 'dummy-id', name: 'Test', company: 'Synthetic', enquiry_prompt: payload, interested_in: [payload], status: payload }],
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', style: {} }); return nodes.get(id); } },
    escHtml: escapeHtml, formatDate: () => 'Test date',
  };
  vm.createContext(context); vm.runInContext(functions, context, { timeout: 1000 });
  await context.loadEnquiries(); context.selectEnquiry('dummy-id');
  for (const id of ['enquiriesTableBody', 'enquiryDetail']) {
    assert.ok(!nodes.get(id).innerHTML.includes(payload));
    assert.ok(nodes.get(id).innerHTML.includes('&lt;img'));
  }
});
