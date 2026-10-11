'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { response } = require('./helpers');

function load() {
  const logged = [];
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const filename = path.join(__dirname, '..', 'api', '_routes', 'csp-report.js');
  const context = { module: { exports: {} }, Buffer, URL, Number, console: { warn: (...a) => logged.push(a.join(' ')) } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { handler: context.module.exports, logged };
}

test('legacy report-uri body is logged without query strings or full blocked URLs', async () => {
  const { handler, logged } = load();
  const res = response();
  await handler({ method: 'POST', body: JSON.stringify({ 'csp-report': {
    'document-uri': 'https://ethosaigovernance.com.au/portal/reset-password?token=secret#access_token=x',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://app.cal.com/embed/embed.js?x=1',
    'line-number': 12,
    'script-sample': '',
  } }) }, res);
  assert.equal(res.code, 204);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /"page":"\/portal\/reset-password"/);
  assert.match(logged[0], /"blocked":"https:\/\/app.cal.com"/);
  assert.doesNotMatch(logged[0], /secret|access_token|embed\.js/);
});

test('Reporting API batches are accepted and non-CSP entries ignored', async () => {
  const { handler, logged } = load();
  const res = response();
  await handler({ method: 'POST', body: [
    { type: 'csp-violation', body: { documentURL: 'https://ethosaigovernance.com.au/services', effectiveDirective: 'script-src-attr', blockedURL: 'inline', sample: 'toggleMobileNav()' } },
    { type: 'deprecation', body: { id: 'x' } },
  ] }, res);
  assert.equal(res.code, 204);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /"directive":"script-src-attr"/);
  assert.match(logged[0], /"blocked":"inline"/);
});

test('malformed or oversized bodies still return 204 and log nothing', async () => {
  for (const body of ['not json', 'x'.repeat(20000), {}, null]) {
    const { handler, logged } = load();
    const res = response();
    await handler({ method: 'POST', body: body === null ? undefined : body }, res);
    assert.equal(res.code, 204);
    assert.equal(logged.length, 0);
  }
});

test('only POST is accepted', async () => {
  const { handler } = load();
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 405);
});

test('an unparsed report body is read from the replayed request stream', async () => {
  const { handler, logged } = load();
  const res = response();
  const { EventEmitter } = require('node:events');
  const req = Object.assign(new EventEmitter(), { method: 'POST', body: undefined });
  const done = handler(req, res);
  req.emit('data', Buffer.from(JSON.stringify({ 'csp-report': { 'document-uri': 'https://ethosaigovernance.com.au/', 'violated-directive': 'frame-src', 'blocked-uri': 'https://app.cal.com/x' } })));
  req.emit('end');
  await done;
  assert.equal(res.code, 204);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /"directive":"frame-src"/);
});
