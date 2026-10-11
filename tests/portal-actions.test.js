'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./helpers');
const { portalAction } = require('../portal/actions');

test('action attributes preserve hostile filenames as JSON data', () => {
  const hostile = `client/O'Brien\"<&>.pdf');globalThis.compromised=true;//`;
  const markup = portalAction('downloadDocument', hostile, hostile);
  assert.ok(!markup.includes('onclick='));
  const matches = [...markup.matchAll(/([a-z-]+)="([^"]*)"/g)];
  assert.equal(matches.length, 2);
  const decode = text => text.replace(/&(quot|#39|lt|gt|amp);/g, (_, entity) => ({ quot: '"', '#39': "'", lt: '<', gt: '>', amp: '&' })[entity]);
  assert.deepEqual(JSON.parse(decode(matches[1][2])), [hostile, hostile]);
});

test('delegated action invokes only the registered function with unchanged arguments', async () => {
  let click, called;
  const context = { document: { addEventListener: (_type, handler) => { click = handler; } }, showToast() { assert.fail('Unexpected action failure'); } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'portal/actions.js'), 'utf8'), context);
  context.registerPortalActions({ downloadDocument: (...args) => { called = args; } });
  const filename = "O'Brien');throw new Error('injected');//.pdf";
  const event = { target: { closest: () => ({ dataset: { portalAction: 'downloadDocument', portalArgs: JSON.stringify(['dummy/path', filename]) } }) }, preventDefault() {}, stopPropagation() {} };
  click(event);
  assert.deepEqual(called, ['dummy/path', filename]);
  called = null;
  event.target.closest = () => ({ dataset: { portalAction: 'constructor', portalArgs: '["globalThis.compromised=true"]' } });
  click(event); assert.equal(called, null); assert.equal(context.compromised, undefined);
});

test('portal page scripts compile and pages carry no inline script or handlers (CSP)', () => {
  for (const [page, script] of [['admin.html', 'admin-page.js'], ['dashboard.html', 'dashboard-page.js']]) {
    const html = fs.readFileSync(path.join(root, 'portal', page), 'utf8');
    assert.ok(html.includes('<script src="actions.js"></script>'));
    assert.ok(html.includes(`<script src="${script}"></script>`));
    assert.ok(!/\son[a-z]+="/.test(html), `${page} has an inline handler`);
    assert.ok(!/<script>/.test(html), `${page} has an inline script`);
    const source = fs.readFileSync(path.join(root, 'portal', script), 'utf8');
    assert.ok(!/on(?:click|change)="[^"\n]*escHtml/.test(source));
    new vm.Script(source);
  }
});

test('every published page is free of inline script and inline handlers', () => {
  const files = require('../scripts/public-files.json').filter(f => f.endswith ? f.endsWith('.html') : false);
  for (const file of files) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/\son(?:click|change|input|keydown|submit|load|error|focus|blur|mouse\w+)="/.test(html), `${file}: inline handler`);
    for (const [, attrs] of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)) assert.ok(/ld\+json/.test(attrs), `${file}: inline script`);
    assert.ok(!/href="javascript:/.test(html), `${file}: javascript: URL`);
    assert.ok(html.includes('<script src="/dom-actions.js" defer></script>'), `${file}: missing dispatcher`);
  }
});

test('toast inserts service error text through textContent', () => {
  const source = fs.readFileSync(path.join(root, 'portal/portal.js'), 'utf8');
  const fn = source.slice(source.indexOf('function showToast('), source.indexOf('// ─── Utility Helpers'));
  let toast;
  const context = {
    document: {
      getElementById: () => ({ appendChild(node) { toast = node; } }),
      createElement: () => ({ append(...children) { this.children = children; }, classList: { add() {}, remove() {} } }),
    },
    requestAnimationFrame() {}, setTimeout() {},
  };
  vm.createContext(context); vm.runInContext(fn, context);
  context.showToast('<img src=x onerror=alert(1)>', 'constructor');
  assert.equal(toast.className, 'toast toast-default');
  assert.equal(toast.children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(toast.innerHTML, undefined);
});
