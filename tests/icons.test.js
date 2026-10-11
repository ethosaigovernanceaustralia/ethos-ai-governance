'use strict';
// Marketing pages load a Material Symbols subset (icon_names=...) instead of
// the 1.1 MB full font. An icon missing from the subset renders as its name
// in plain text, so every icon these pages or their scripts use must be listed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./helpers');

const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const used = src => [...src.matchAll(/material-symbols-outlined[^"]*"[^>]*>\s*([a-z0-9_]+)\s*</g)].map(m => m[1]);
const SCRIPTS = { 'app.js': true, 'booking.js': true };

test('every icon used on a subset page is in that page\'s icon_names list', () => {
  const pages = require('../scripts/public-files.json').filter(f => f.endsWith('.html'));
  let checked = 0;
  for (const page of pages) {
    const html = read(page);
    const m = html.match(/Material\+Symbols\+Outlined[^"]*icon_names=([a-z0-9_,]+)/);
    if (!m) continue;
    checked++;
    const listed = m[1].split(',');
    assert.deepEqual([...listed], [...listed].sort(), `${page}: icon_names must be alphabetical for Google Fonts`);
    const scripts = [...html.matchAll(/<script[^>]+src="\/?([^"]+)"/g)].map(s => s[1]).filter(s => SCRIPTS[s]);
    const needed = new Set([...used(html), ...scripts.flatMap(s => used(read(s)))]);
    const missing = [...needed].filter(n => !listed.includes(n));
    assert.deepEqual(missing, [], `${page}: icons missing from the font subset`);
  }
  assert.ok(checked >= 9, `expected the marketing pages to use the subset, found ${checked}`);
});
