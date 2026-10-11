'use strict';
// ─── Ethos — SEO integrity checks (SEO-14) ───────────────────────────────────
//   npm run check:seo                                   local source checks
//   npm run check:seo -- --base-url <origin> [--report <file>]
//                                                       read-only HTTP checks
// The indexation intent lives in scripts/seo-routes.json (the route contract in
// the SEO plan). Local checks read the files that the public build publishes;
// HTTP checks fetch routes without following redirects. Neither mutates anything.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contract = require('./seo-routes.json');
const published = new Set(require('./public-files.json'));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

const all = (html, re) => [...html.matchAll(re)].map(m => m[1]);
const meta = (html, name) => all(html, new RegExp(`<meta[^>]+(?:name|property)="${name}"[^>]+content="([^"]*)"`, 'gi'));
const canonical = html => all(html, /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/gi);
const robots = html => (meta(html, 'robots')[0] || '').toLowerCase();
const stripScripts = html => html.replace(/<script[\s\S]*?<\/script>/gi, '');

// Resolve a link/asset reference as the browser would from a served route.
function resolveFrom(route, ref) {
  const u = new URL(ref, contract.origin + route);
  return u.origin === contract.origin ? u : null;
}

// Map a public URL path to the published file that serves it (explicit
// rewrites and files only; mirrors vercel.json without reimplementing Vercel).
const vercel = JSON.parse(read('vercel.json'));
const rewrites = new Map((vercel.rewrites || []).map(r => [r.source, r.destination.replace(/^\//, '')]));
function fileForPath(p) {
  if (p === '/') return 'index.html';
  if (rewrites.has(p)) return rewrites.get(p);
  const f = p.replace(/^\//, '');
  return published.has(f) ? f : null;
}

function localChecks() {
  const titles = new Map(), descriptions = new Map();
  for (const { route, file } of contract.indexable) {
    const html = read(file), where = `${route} (${file})`;
    if (!published.has(file)) fail(where, 'not in the public build manifest');
    const t = all(html, /<title>([^<]*)<\/title>/gi), d = meta(html, 'description'), c = canonical(html);
    if (t.length !== 1) fail(where, `expected one <title>, found ${t.length}`);
    if (d.length !== 1) fail(where, `expected one meta description, found ${d.length}`);
    if (c.length !== 1 || c[0] !== contract.origin + route) fail(where, `canonical should be ${contract.origin + route}, found ${c.join(', ') || 'none'}`);
    const og = meta(html, 'og:url')[0];
    if (og && og !== contract.origin + route) fail(where, `og:url ${og} does not match the canonical`);
    if (/noindex/.test(robots(html))) fail(where, 'public page is noindex');
    if ((stripScripts(html).match(/<h1[\s>]/gi) || []).length !== 1) fail(where, 'expected exactly one <h1>');
    if (t[0]) { if (titles.has(t[0])) fail(where, `title duplicates ${titles.get(t[0])}`); titles.set(t[0], route); }
    if (d[0]) { if (descriptions.has(d[0])) fail(where, `description duplicates ${descriptions.get(d[0])}`); descriptions.set(d[0], route); }
    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
      try { JSON.parse(json); } catch { fail(where, 'JSON-LD does not parse'); }
    }
    for (const word of ['TODO', '[PRICE', 'TBC]', 'lorem ipsum']) {
      if (stripScripts(html).includes(word)) fail(where, `placeholder text "${word}" in a public page`);
    }
  }
  for (const { route, file } of contract.noindex) {
    if (!/noindex/.test(robots(read(file)))) fail(`${route} (${file})`, 'utility/interim page lacks <meta name="robots" content="noindex">');
  }
  const portalHeader = (vercel.headers || []).some(h => h.source === '/portal/:path*' &&
    h.headers.some(x => x.key.toLowerCase() === 'x-robots-tag' && /noindex/.test(x.value)));
  if (!portalHeader) fail('vercel.json', 'missing X-Robots-Tag noindex header for /portal/:path*');
  for (const d of contract.drafts) if (published.has(d)) fail(d, 'draft page is in the public build');

  // Sitemap: exactly the indexable routes, no unmaintained date/priority fields.
  const sitemap = read('sitemap.xml');
  const locs = all(sitemap, /<loc>([^<]+)<\/loc>/g);
  const want = contract.indexable.map(r => contract.origin + r.route);
  if (!/^<\?xml[^>]*\?>\s*<urlset[^>]*>[\s\S]*<\/urlset>\s*$/.test(sitemap.trim())) fail('sitemap.xml', 'not a single <urlset> document');
  if (JSON.stringify([...locs].sort()) !== JSON.stringify([...want].sort())) fail('sitemap.xml', `URLs differ from the contract: has ${locs.join(', ')}`);
  if (/<(lastmod|priority|changefreq)>/.test(sitemap)) fail('sitemap.xml', 'contains lastmod/priority/changefreq without a maintained source');

  const robotsTxt = read('robots.txt');
  if (!robotsTxt.includes(`Sitemap: ${contract.origin}/sitemap.xml`)) fail('robots.txt', 'missing canonical Sitemap line');
  if (/^\s*Disallow:\s*\/portal/im.test(robotsTxt)) fail('robots.txt', 'disallows /portal, which hides its noindex from crawlers');

  if (!published.has('404.html')) fail('404.html', 'missing genuine 404 page in the public build');

  // Local links and assets resolve from each served route; fragments exist.
  const served = [...contract.indexable, ...contract.noindex, { route: '/404', file: '404.html' }];
  for (const { route, file } of served) {
    if (!published.has(file) && file !== '404.html') continue;
    let html; try { html = read(file); } catch { continue; }
    const refs = [...all(html, /\s(?:src|href)="([^"]+)"/gi)];
    for (const ref of refs) {
      if (/^(mailto:|tel:|https?:|data:|#$|javascript:)/i.test(ref) && !ref.startsWith(contract.origin)) continue;
      const u = resolveFrom(route, ref);
      if (!u) continue;
      const target = fileForPath(decodeURIComponent(u.pathname));
      if (!target) { fail(`${route} (${file})`, `reference "${ref}" resolves to ${u.pathname}, which nothing serves`); continue; }
      if (u.hash && target.endsWith('.html')) {
        const id = u.hash.slice(1);
        if (id && !new RegExp(`\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(read(target))) fail(`${route} (${file})`, `fragment "${ref}" has no id="${id}" in ${target}`);
      }
    }
  }
}

async function httpChecks(base, reportFile) {
  const report = [];
  const get = async (p, follow = false) => {
    const res = await fetch(base + p, { redirect: follow ? 'follow' : 'manual', headers: { 'user-agent': 'ethos-check-seo/1' } });
    const body = res.status === 200 ? await res.text() : '';
    return { status: res.status, location: res.headers.get('location'), xRobots: res.headers.get('x-robots-tag'), body };
  };
  for (const { route } of contract.indexable) {
    const r = await get(route);
    report.push({ route, status: r.status, canonical: canonical(r.body)[0] || null, robots: robots(r.body) || null, xRobots: r.xRobots });
    if (r.status !== 200) fail(route, `expected 200, got ${r.status}`);
    else {
      if (canonical(r.body)[0] !== contract.origin + route) fail(route, 'live canonical does not match');
      if (/noindex/.test(robots(r.body) + (r.xRobots || ''))) fail(route, 'live public page is noindex');
    }
  }
  for (const { route } of contract.noindex) {
    const r = await get(route);
    report.push({ route, status: r.status, robots: robots(r.body) || null, xRobots: r.xRobots });
    if (r.status !== 200) fail(route, `expected 200, got ${r.status}`);
    else if (!/noindex/.test(robots(r.body) + (r.xRobots || ''))) fail(route, 'utility page is indexable');
  }
  const aliases = contract.indexable.filter(r => r.route !== '/').flatMap(r => [[`/${r.file}`, r.route], [`${r.route}/`, r.route]]);
  aliases.push(['/index.html', '/']);
  for (const [alias, to] of aliases) {
    const r = await get(alias);
    const dest = r.location ? new URL(r.location, base).pathname : null;
    report.push({ route: alias, status: r.status, location: dest });
    if (![301, 308].includes(r.status) || dest !== to) fail(alias, `expected a permanent redirect to ${to}, got ${r.status} ${dest || ''}`);
  }
  const missing = await get('/no-such-page-check-seo');
  report.push({ route: '/no-such-page-check-seo', status: missing.status });
  if (missing.status !== 404) fail('unknown route', `expected 404, got ${missing.status}`);
  const sitemap = await get('/sitemap.xml');
  const locs = all(sitemap.body, /<loc>([^<]+)<\/loc>/g);
  report.push({ route: '/sitemap.xml', status: sitemap.status, urls: locs });
  if (JSON.stringify(locs.sort()) !== JSON.stringify(contract.indexable.map(r => contract.origin + r.route).sort())) fail('/sitemap.xml', 'live sitemap differs from the contract');
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify({ base, checkedAt: new Date().toISOString(), report, failures }, null, 1) + '\n');
}

(async () => {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--base-url'), repIdx = args.indexOf('--report');
  if (baseIdx >= 0) await httpChecks(args[baseIdx + 1].replace(/\/$/, ''), repIdx >= 0 ? args[repIdx + 1] : null);
  else localChecks();
  if (failures.length) {
    console.error(`SEO checks failed (${failures.length}):\n- ` + failures.join('\n- '));
    process.exit(1);
  }
  console.log(baseIdx >= 0 ? 'SEO HTTP checks passed.' : 'SEO local checks passed.');
})();
