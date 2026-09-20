import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { releaseVersions, planBuilds, normalizeBase, versionSwitcher, versionBanner, currentVersion } from '../lib/versions.mjs';
import { build, parseArgs } from '../build.mjs';
import { buildAll } from '../build-all.mjs';
import { makeTempDir } from '../../test-utils/tmpdir.mjs';

const BUILD_TIME = new Date('2026-09-20T00:00:00Z');
const TAGS = ['v0.8.0', 'v0.8.2', 'v0.8.1', 'v0.9.0', 'v1.0.0', 'v1.0.0-rc.1', 'latest', 'vx.y.z', 'v0.10.0'];

test('releaseVersions: newest patch per minor, newest minor first, junk ignored', () => {
  assert.deepEqual(
    releaseVersions(TAGS).map((r) => [r.id, r.tag]),
    [['1.0', 'v1.0.0'], ['0.10', 'v0.10.0'], ['0.9', 'v0.9.0'], ['0.8', 'v0.8.2']],
  );
  assert.deepEqual(releaseVersions([]), []);
});

test('normalizeBase', () => {
  assert.equal(normalizeBase('construct/0.8'), '/construct/0.8/');
  assert.equal(normalizeBase('/'), '/');
  assert.equal(normalizeBase(''), '/');
});

test('planBuilds with releases: root = newest, /X.Y/ each, /next/ = main, next last in the switcher', () => {
  const { builds, versions } = planBuilds(['v0.8.0', 'v0.9.1', 'v0.9.0'], { siteBase: '/construct/', nextRef: 'main' });
  assert.deepEqual(builds.map((b) => [b.dir, b.ref, b.latest]), [['', 'v0.9.1', true], ['0.9', 'v0.9.1', true], ['0.8', 'v0.8.0', false], ['next', 'main', false]]);
  assert.deepEqual(versions.map((v) => [v.label, v.base, v.latest]), [['v0.9', '/construct/', true], ['v0.8', '/construct/0.8/', false], ['next', '/construct/next/', false]]);
});

test('planBuilds with no tags: main is both root and /next/, shown as next', () => {
  const { builds, versions } = planBuilds([], { siteBase: '/construct/', nextRef: 'main' });
  assert.deepEqual(builds.map((b) => [b.dir, b.ref, b.id, b.latest]), [['', 'main', 'next', true], ['next', 'main', 'next', true]]);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].label, 'next');
});

const VERSIONS = [
  { id: '0.9', label: 'v0.9', base: '/construct/', latest: true },
  { id: '0.8', label: 'v0.8', base: '/construct/0.8/', latest: false },
  { id: 'next', label: 'next', base: '/construct/next/', latest: false },
];

test('switcher: real links to the same page in every version, current marked, accessible name, no script', () => {
  const current = currentVersion(VERSIONS, { basePath: '/construct/0.8/', version: '0.8' });
  const html = versionSwitcher({ versions: VERSIONS, current, pagePath: 'user-guide/getting-started/' });
  assert.match(html, /<details class="ver-switch"><summary aria-label="Documentation version: v0\.8\. Change version">/);
  assert.match(html, /href="\/construct\/user-guide\/getting-started\/">v0\.9 <span class="ver-tag">latest/);
  assert.match(html, /href="\/construct\/0\.8\/user-guide\/getting-started\/" aria-current="true">v0\.8/);
  assert.match(html, /href="\/construct\/next\/user-guide\/getting-started\/">next <span class="ver-tag">unreleased/);
  assert.doesNotMatch(html, /<script/);
  assert.equal(versionSwitcher({ versions: [VERSIONS[0]], current: VERSIONS[0] }), '', 'a single version needs no switcher');
});

test('banner: only on non-latest pages, links to latest', () => {
  const at = (basePath, version) => versionBanner({ versions: VERSIONS, current: currentVersion(VERSIONS, { basePath, version }) });
  assert.equal(at('/construct/', '0.9'), '');
  assert.match(at('/construct/0.8/', '0.8'), /You are reading docs for v0\.8\. <a href="\/construct\/">See latest \(v0\.9\)<\/a>/);
  assert.match(at('/construct/next/', 'next'), /unreleased docs \(next\)/);
});

test('build with --base-path/--version: canonical, sitemap and links honour the base; switcher and banner render', async () => {
  const out = makeTempDir('site-ver-');
  await build({ out, repo: 'o/r', buildTime: BUILD_TIME, basePath: '/r/0.8', version: '0.8', versions: VERSIONS });
  const page = fs.readFileSync(path.join(out, 'user-guide/getting-started/index.html'), 'utf8');
  assert.match(page, /<link rel="canonical" href="https:\/\/o\.github\.io\/r\/0\.8\/user-guide\/getting-started\/">/);
  assert.match(page, /class="ver-banner"/);
  assert.match(page, /class="ver-switch"/);
  assert.match(page, /href="\.\.\/\.\.\/assets\/css\/site\.css"/, 'asset links stay relative, so they work under any base');
  assert.match(fs.readFileSync(path.join(out, 'sitemap.txt'), 'utf8'), /^https:\/\/o\.github\.io\/r\/0\.8\/$/m);
  assert.match(fs.readFileSync(path.join(out, '404.html'), 'utf8'), /<base href="\/r\/0\.8\/">/);
  const search = fs.readFileSync(path.join(out, 'search/index.html'), 'utf8');
  assert.match(search, /data-root="\.\.\/"/);
  assert.match(search, /src="\.\.\/pagefind\/pagefind-ui\.js"/, 'search index path is relative to the versioned root');
});

test('build without the flags is unchanged: no switcher, no banner', async () => {
  const out = makeTempDir('site-ver-default-');
  await build({ out, repo: 'o/r', buildTime: BUILD_TIME });
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(home, /ver-switch|ver-banner/);
  assert.match(home, /<link rel="canonical" href="https:\/\/o\.github\.io\/r\/">/);
});

test('parseArgs accepts the version flags', () => {
  assert.deepEqual(parseArgs(['--base-path', '/r/0.8/', '--version', '0.8']), { 'base-path': '/r/0.8/', version: '0.8' });
});

const fakeRun = (calls) => ({ ref, dest, args }) => {
  calls.push({ ref, args });
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'index.html'), `built ${ref} ${args[args.indexOf('--base-path') + 1]}`);
};

test('buildAll with no tags builds main as root and /next/ into one artifact', () => {
  const out = makeTempDir('site-all-');
  const calls = [];
  const plan = buildAll({ repoDir: '.', out, repo: 'o/r', tags: [], nextRef: 'main', run: fakeRun(calls) });
  assert.equal(plan.versions.length, 1);
  assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), 'built main /r/');
  assert.equal(fs.readFileSync(path.join(out, 'next/index.html'), 'utf8'), 'built main /r/next/');
  assert.ok(calls.every((c) => c.args.includes('--versions-file') && c.args.includes('next')));
});

test('buildAll with tags: root = newest tag, /X.Y/ per minor, /next/ = main', () => {
  const out = makeTempDir('site-all-tags-');
  const calls = [];
  buildAll({ repoDir: '.', out, repo: 'o/r', tags: ['v0.8.0', 'v0.9.0', 'v0.9.1'], nextRef: 'main', search: false, run: fakeRun(calls) });
  const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
  assert.equal(read('index.html'), 'built v0.9.1 /r/');
  assert.equal(read('0.9/index.html'), 'built v0.9.1 /r/0.9/');
  assert.equal(read('0.8/index.html'), 'built v0.8.0 /r/0.8/');
  assert.equal(read('next/index.html'), 'built main /r/next/');
  assert.ok(calls.every((c) => c.args.includes('--no-search')));
});
