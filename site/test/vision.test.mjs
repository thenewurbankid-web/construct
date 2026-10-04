import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../build.mjs';
import { parseSnapshot, renderVisionStatus, duration } from '../../packages/docs-site/lib/visionStatus.mjs';
import { makeTempDir } from '../../test-utils/tmpdir.mjs';

const BUILD_TIME = new Date('2026-10-04T00:00:00Z');
const SAMPLE = JSON.parse(fs.readFileSync(new URL('./fixtures/vision-status.json', import.meta.url), 'utf8'));
const walk = (d, files = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name), files) : files.push(path.join(d, e.name)));
  return files;
};
const hostile = () => {
  const s = structuredClone(SAMPLE);
  s.runs[0].spec = '<script>alert(1)</script>';
  s.runs[1].status = '"><b>x</b>';
  s.library.components[0].name = '<script>alert("x")</script>';
  s.library.components[0].whereUsed = [{ page: '"><img src=x onerror=alert(1)>', via: 'store' }];
  return s;
};
const read = (out, rel) => fs.readFileSync(path.join(out, rel), 'utf8');
const buildVision = async (opts = {}) => {
  const out = makeTempDir('vision-test-');
  const visionSnapshot = opts.repoRoot ? undefined : SAMPLE; // never fall through to site/data/
  await build({ out, repo: 'o/r', buildTime: BUILD_TIME, api: false, visionSnapshot, ...opts });
  return out;
};

test('the fixture parses and renders runs newest first and every component', () => {
  const html = renderVisionStatus(parseSnapshot(SAMPLE));
  assert.ok(html.indexOf('fake-run-0004') < html.indexOf('fake-run-0003') && html.indexOf('fake-run-0003') < html.indexOf('fake-run-0002') && html.indexOf('fake-run-0002') < html.indexOf('fake-run-0001'));
  for (const n of ['fake-button', 'fake-card', 'fake-hero']) assert.match(html, new RegExp(n));
  assert.match(html, /<caption>/);
  assert.match(html, /<th scope="col">Duration<\/th>/);
  assert.match(html, /<th scope="col" class="vs-n">Extended<\/th>/);
  assert.match(html, /The five counts/);
  assert.doesNotMatch(html, />running</);
  assert.match(html, />no report</);
  assert.match(html, />42 min 30 s</);
  for (const s of ['finished', 'stopped', 'unfinished']) assert.match(html, new RegExp(`<span class="vs-badge vs-badge-${s}">${s}</span>`));
  assert.match(html, /wrote its report/);
  assert.match(html, /ended early \(quota or budget\)/);
  assert.match(html, /no report: still going, or ended without one/);
  assert.match(html, /<td class="vs-n">3<\/td><td class="vs-n">5<\/td>/);
  assert.match(html, /Used on 2 pages/);
  assert.match(html, /https:\/\/example\.test\/pricing <span class="vs-via">\(reuse, store\)<\/span>/);
  assert.match(html, /page not public <span class="vs-via">\(store\)<\/span>/);
  assert.match(html, /Also known as: <code>Fake CTA<\/code>/);
  assert.match(html, /latest <strong>2<\/strong>/);
  assert.match(html, /<strong>1<\/strong>, 2026-09-28, store/);
  assert.match(html, /<label for="vs-q">/);
});

test('null spec, model, latestVersion and updatedAt render an en dash, never "null" or an empty cell', () => {
  const html = renderVisionStatus(parseSnapshot(SAMPLE));
  assert.doesNotMatch(html, /null|undefined|<td><\/td>/);
  assert.match(html, /<code>fake-run-0004<\/code><\/th><td>\u2013<\/td><td>\u2013<\/td>/);
  assert.match(html, /latest <strong>\u2013<\/strong>, updated \u2013<\/p>/);
  assert.match(html, /fake-model-a \+ fake-model-b/);
});

test('values are HTML-escaped', () => {
  const html = renderVisionStatus(parseSnapshot(hostile()));
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('as-of stamp: time element, plain UTC string, counts', () => {
  const html = renderVisionStatus(parseSnapshot(SAMPLE));
  assert.match(html, /As of <time datetime="2026-10-04T09:30:00.000Z">2026-10-04 09:30 UTC<\/time>: 4 runs and 3 components\./);
});

test('duration', () => {
  assert.equal(duration('2026-10-04T00:00:00Z', null), 'no report');
  assert.equal(duration('2026-10-04T00:00:00Z', '2026-10-04T00:00:20Z'), '20 s');
  assert.equal(duration('2026-10-04T00:00:00Z', '2026-10-04T02:05:00Z'), '2 h 5 min');
});

test('missing, malformed or unknown-schema snapshots show "No snapshot yet" and the build is green', async () => {
  for (const snap of [null, { ...SAMPLE, schemaVersion: 2 }, '{ not json', { schemaVersion: 1 }]) {
    const out = await buildVision({ visionSnapshot: snap });
    const page = read(out, 'vision/index.html');
    assert.match(page, /No snapshot yet/);
    assert.doesNotMatch(page, /fake-run/);
  }
  // No site/data/vision-status.json at all: a repo mirror (symlinks) whose site/ has no data/ directory.
  const repoRoot = makeTempDir('vision-norepo-');
  const here = path.resolve(import.meta.dirname, '../..');
  for (const e of fs.readdirSync(here)) if (e !== 'site' && e !== '.git') fs.symlinkSync(path.join(here, e), path.join(repoRoot, e));
  fs.mkdirSync(path.join(repoRoot, 'site'));
  for (const e of fs.readdirSync(path.join(here, 'site'))) if (e !== 'data') fs.symlinkSync(path.join(here, 'site', e), path.join(repoRoot, 'site', e));
  const out = await buildVision({ repoRoot });
  assert.match(read(out, 'vision/index.html'), /No snapshot yet/);
});

test('the built page: intro, data, escaped fixture, header nav, breadcrumb, sitemap', async () => {
  const out = await buildVision({ visionSnapshot: hostile() });
  const page = read(out, 'vision/index.html');
  assert.match(page, /<h1>Vision<\/h1>/);
  assert.match(page, /This page is a snapshot/);
  assert.match(page, /<a href="\.\.\/vision\/" aria-current="page">Vision<\/a>/);
  assert.match(page, /<nav class="crumbs"[^>]*><a href="\.\.\/">Home<\/a> <span aria-hidden="true">\/<\/span> <a href="\.\.\/vision\/">Vision<\/a><\/nav>/);
  assert.match(page, /<script src="\.\.\/assets\/js\/vision-library\.js" defer><\/script>/);
  assert.doesNotMatch(page, /<script>alert/);
  assert.ok(fs.existsSync(path.join(out, 'assets/js/vision-library.js')));
  assert.match(read(out, 'sitemap.txt'), /^https:\/\/o\.github\.io\/r\/vision\/$/m);
  assert.match(read(out, 'index.html'), /<a href="vision\/">Vision<\/a>/);
});

test('base-path variants: the section works under /construct/ and /construct/1.2/', async () => {
  for (const basePath of ['/construct/', '/construct/1.2/']) {
    const out = await buildVision({ basePath });
    assert.match(read(out, 'sitemap.txt'), new RegExp(`^https://o\\.github\\.io${basePath}vision/$`, 'm'));
    const page = read(out, 'vision/index.html');
    assert.match(page, new RegExp(`<link rel="canonical" href="https://o\\.github\\.io${basePath}vision/">`));
    assert.match(page, /href="\.\.\/assets\/css\/site\.css"/);
    assert.match(page, /href="\.\.\/vision\/"/);
    assert.match(read(out, '404.html'), new RegExp(`<base href="${basePath}">`));
  }
});

test('no absolute /Users/ path anywhere in the built output', async () => {
  const out = await buildVision();
  for (const f of walk(out).filter((x) => /\.(html|txt|json|js|css)$/.test(x))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\/Users\//, f);
});
