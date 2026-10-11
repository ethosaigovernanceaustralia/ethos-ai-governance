'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./helpers');

// Minimal DOM: elements with attributes, parents and closest().
function el(attrs = {}, parent = null) {
  return {
    attrs, parentElement: parent,
    get dataset() { return { args: attrs['data-args'] }; },
    getAttribute(n) { return Object.hasOwn(attrs, n) ? attrs[n] : null; },
    hasAttribute(n) { return Object.hasOwn(attrs, n); },
    closest(sel) { const a = sel.slice(1, -1); let e = this; while (e) { if (e.hasAttribute(a)) return e; e = e.parentElement; } return null; },
  };
}

function load(globals) {
  const listeners = {};
  class Element {}
  const context = { ...globals, Element, document: { addEventListener: (t, fn) => { listeners[t] = fn; } }, window: null, Object, JSON, Array, Set, Math };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dom-actions.js'), 'utf8'), context);
  return (type, target) => {
    Object.setPrototypeOf(target, Element.prototype);
    const event = { type, target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    listeners[type](event); return event;
  };
}

test('allow-listed function receives literal and special arguments', () => {
  const calls = [];
  const fire = load({ toggleFaq: (...a) => calls.push(a) });
  const button = el({ 'data-on-click': 'toggleFaq', 'data-args': '["$this","x",3]' });
  fire('click', button);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], button);
  assert.deepEqual(calls[0].slice(1), ['x', 3]);
});

test('functions outside the allow-list and malformed arguments never run', () => {
  let ran = false;
  const fire = load({ notAllowed: () => { ran = true; }, toggleFaq: () => { ran = true; } });
  fire('click', el({ 'data-on-click': 'notAllowed' }));
  fire('click', el({ 'data-on-click': 'constructor' }));
  fire('click', el({ 'data-on-click': 'toggleFaq', 'data-args': '{not json' }));
  fire('click', el({ 'data-on-click': 'toggleFaq', 'data-args': '{"a":1}' }));
  assert.equal(ran, false);
});

test('handlers bubble outwards until data-stop, and data-prevent prevents default', () => {
  const order = [];
  const fire = load({ selectClient: id => order.push('outer:' + id), handleArchiveClient: id => order.push('inner:' + id) });
  const outer = el({ 'data-on-click': 'selectClient', 'data-args': '["c1"]' });
  const inner = el({ 'data-on-click': 'handleArchiveClient', 'data-args': '["c1"]', 'data-stop': '' }, outer);
  const ev = fire('click', inner);
  assert.deepEqual(order, ['inner:c1']);
  assert.equal(ev.stopped, true);
  order.length = 0;
  const plain = el({ 'data-on-click': 'handleArchiveClient', 'data-args': '["c2"]', 'data-prevent': '' }, outer);
  const ev2 = fire('click', plain);
  assert.deepEqual(order, ['inner:c2', 'outer:c1']);
  assert.equal(ev2.defaultPrevented, true);
});

test('an element with several handlers uses per-event arguments', () => {
  const calls = [];
  const fire = load({ handleChatKeydown: e => calls.push(['key', e.type]) });
  const box = el({ 'data-on-keydown': 'handleChatKeydown', 'data-args-keydown': '["$event"]', 'data-on-input': 'domAutoGrow', 'data-args-input': '["$this"]' });
  box.style = {}; box.scrollHeight = 300;
  fire('keydown', box);
  fire('input', box);
  assert.deepEqual(calls, [['key', 'keydown']]);
  assert.equal(box.style.height, '120px');
});

test('every published element with several handlers has per-event arguments', () => {
  const files = require('../scripts/public-files.json').filter(f => /\.(html|js)$/.test(f));
  for (const f of files) {
    for (const [tag] of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/<[a-zA-Z][^<>]*>/g)) {
      if ((tag.match(/data-on-[a-z]+=/g) || []).length > 1) assert.ok(!/\sdata-args=/.test(tag), `${f}: ${tag.slice(0, 80)}`);
    }
  }
});
