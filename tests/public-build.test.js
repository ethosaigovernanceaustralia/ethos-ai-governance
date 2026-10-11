'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPublic } = require('../scripts/build-public');
const files = require('../scripts/public-files.json');
const { root } = require('./helpers');

test('public build copies exact reviewed files and excludes internal files and stale output', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ethos-public-'));
  try {
    for (const file of files) {
      assert.ok(fs.statSync(path.join(root, file)).isFile());
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      fs.writeFileSync(path.join(fixture, file), 'public');
    }
    const denied = ['.env', '.claude/settings.local.json', 'supabase-setup.sql', 'api/booking.js', 'lib/html.js', 'graphify-out/cache.json', 'notes.md', 'portal/client_portal_analysis.txt', 'assets/unreviewed.png', 'adm-self-check.html', 'adm-sprint.html', 'deal-rescue.html', 'iso-gap-assessment.html', 'legal-privacy.html', 'legal-terms.html'];
    for (const file of denied) {
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      fs.writeFileSync(path.join(fixture, file), 'synthetic-private');
    }
    fs.mkdirSync(path.join(fixture, 'dist')); fs.writeFileSync(path.join(fixture, 'dist/stale.txt'), 'old');
    assert.equal(buildPublic(fixture), files.length);
    for (const file of [...denied, 'stale.txt']) assert.ok(!fs.existsSync(path.join(fixture, 'dist', file)), file);
    for (const file of files) assert.equal(fs.readFileSync(path.join(fixture, 'dist', file), 'utf8'), 'public');
    const vercel = require('../vercel.json');
    for (const rewrite of vercel.rewrites) assert.ok(files.includes(rewrite.destination.slice(1)), rewrite.destination);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('public build rejects symlink inputs', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ethos-link-'));
  try {
    fs.symlinkSync(path.join(root, files[0]), path.join(fixture, files[0]));
    assert.throws(() => buildPublic(fixture), /Symlink/);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
