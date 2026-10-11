'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { root } = require('./helpers');

test('SEO local checks pass (route contract, noindex, sitemap, robots, 404, assets and fragments)', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-seo.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('animated content has a visible fallback when JavaScript or AOS is unavailable', () => {
  const fs = require('node:fs');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /html:not\(\.js\) \[data-aos\],\s*html\.aos-off \[data-aos\]\s*\{[^}]*opacity: 1 !important/);
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /typeof AOS === 'undefined'[\s\S]*?classList\.add\('aos-off'\)/);
  for (const f of require('../scripts/public-files.json').filter(x => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    if (html.includes('data-aos')) assert.ok(html.includes('<script src="/js-ready.js"></script>'), `${f}: missing js-ready.js`);
  }
});
