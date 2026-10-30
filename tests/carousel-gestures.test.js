'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const attach = require('../carousel-gestures');

function fixture() {
  const listeners = new Map();
  const changes = [];
  const surface = {
    clientWidth: 400,
    addEventListener(type, fn, options) {
      listeners.set(type, { fn, options });
    },
    setPointerCapture() {},
  };
  attach(surface, direction => changes.push(direction));
  let time = 1000;
  function fire(type, data = {}) {
    const event = {
      pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true,
      clientX: 200, clientY: 100, deltaX: 0, deltaY: 0, deltaMode: 0,
      timeStamp: time += 10, detail: 1, cancelable: true, target: surface,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...data,
    };
    listeners.get(type).fn(event);
    return event;
  }
  return { surface, listeners, changes, fire };
}

test('finger swipes change one card in the direction of travel', () => {
  const f = fixture();
  f.fire('pointerdown', { clientX: 250 });
  f.fire('pointermove', { clientX: 160 });
  f.fire('pointerup', { clientX: 130 });
  f.fire('pointerdown', { clientX: 130 });
  f.fire('pointerup', { clientX: 250 });
  assert.deepEqual(f.changes, [1, -1]);
});

test('small movements remain taps and do not swallow card clicks', () => {
  const f = fixture();
  f.fire('pointerdown');
  f.fire('pointerup', { clientX: 220 });
  const click = f.fire('click');
  assert.deepEqual(f.changes, []);
  assert.equal(click.prevented, false);
  assert.equal(click.stopped, false);
});

test('vertical scrolling, cancelled gestures and a second finger never change cards', () => {
  const f = fixture();
  const down = f.fire('pointerdown');
  const vertical = f.fire('pointermove', { clientX: 205, clientY: 160 });
  f.fire('pointerup', { clientX: 120, clientY: 180 });
  f.fire('pointerdown');
  f.fire('pointercancel');
  f.fire('pointerup', { clientX: 100 });
  f.fire('pointerdown');
  f.fire('pointerdown', { pointerId: 2, isPrimary: false });
  f.fire('pointerup', { clientX: 100 });
  assert.deepEqual(f.changes, []);
  assert.equal(down.prevented, false);
  assert.equal(vertical.prevented, false);
});

test('a swipe cannot also activate the card under the released finger', () => {
  const f = fixture();
  f.fire('pointerdown', { timeStamp: 100 });
  f.fire('pointerup', { clientX: 100, timeStamp: 200 });
  const syntheticClick = f.fire('click', { timeStamp: 210 });
  const keyboardClick = f.fire('click', { timeStamp: 220, detail: 0 });
  const laterTap = f.fire('click', { timeStamp: 800 });
  assert.equal(syntheticClick.prevented, true);
  assert.equal(syntheticClick.stopped, true);
  assert.equal(keyboardClick.prevented, false);
  assert.equal(laterTap.prevented, false);
  assert.deepEqual(f.changes, [1]);
  assert.equal(f.listeners.get('click').options, true);
});

test('horizontal trackpad deltas accumulate, with one card per inertial gesture', () => {
  const f = fixture();
  f.fire('wheel', { deltaX: 20, timeStamp: 100 });
  f.fire('wheel', { deltaX: 20, timeStamp: 120 });
  assert.deepEqual(f.changes, []);
  f.fire('wheel', { deltaX: 20, timeStamp: 140 });
  for (let t = 160; t < 500; t += 20) f.fire('wheel', { deltaX: 30, timeStamp: t });
  assert.deepEqual(f.changes, [1]);
  f.fire('wheel', { deltaX: -60, timeStamp: 800 });
  assert.deepEqual(f.changes, [1, -1]);
  assert.equal(f.listeners.get('wheel').options.passive, false);
});

test('vertical and diagonal trackpad scrolling and pinch zoom keep browser defaults', () => {
  const f = fixture();
  for (const data of [
    { deltaY: 120 },
    { deltaX: 20, deltaY: 100 },
    { deltaX: 50, deltaY: 50 },
    { deltaX: 100, ctrlKey: true },
  ]) assert.equal(f.fire('wheel', data).prevented, false);
  assert.deepEqual(f.changes, []);
});

test('wheel line/page units work and non-cancelable events are not prevented', () => {
  const f = fixture();
  assert.equal(f.fire('wheel', { deltaX: 3, deltaMode: 1, timeStamp: 100 }).prevented, true);
  f.fire('wheel', { deltaX: -1, deltaMode: 2, timeStamp: 500 });
  const event = f.fire('wheel', { deltaX: 60, cancelable: false, timeStamp: 900 });
  assert.equal(event.prevented, false);
  assert.deepEqual(f.changes, [1, -1, 1]);
});

test('mouse dragging works but secondary mouse buttons do not select a card', () => {
  const f = fixture();
  f.fire('pointerdown', { pointerType: 'mouse', button: 2 });
  f.fire('pointerup', { pointerType: 'mouse', clientX: 100 });
  assert.deepEqual(f.changes, []);
  assert.equal(f.fire('pointerdown', { pointerType: 'mouse' }).prevented, true);
  f.fire('pointermove', { pointerType: 'mouse', clientX: 100 });
  f.fire('pointerup', { pointerType: 'mouse', clientX: 100 });
  assert.deepEqual(f.changes, [1]);
});

test('arrow keys work on the focused carousel without hijacking child controls or page scrolling', () => {
  const f = fixture();
  assert.equal(f.fire('keydown', { key: 'ArrowRight' }).prevented, true);
  assert.equal(f.fire('keydown', { key: 'ArrowLeft' }).prevented, true);
  assert.equal(f.fire('keydown', { key: 'ArrowDown' }).prevented, false);
  assert.equal(f.fire('keydown', { key: 'ArrowRight', target: {} }).prevented, false);
  assert.deepEqual(f.changes, [1, -1]);
});
