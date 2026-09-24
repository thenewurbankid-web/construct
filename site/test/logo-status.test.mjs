// The docs logo as a status light: the script's pure parts (loaded as a plain script in a sandbox, since the repository treats .js as
// modules), and the markup and CSS it drives. The endpoint is never in the page or the repository: only a visitor who set it
// themselves makes a request.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SCRIPT = read('site/assets/js/logo-status.js');
const load = () => {
  const sandbox = { module: { exports: {} }, URL, URLSearchParams };
  vm.runInNewContext(SCRIPT, sandbox);
  return sandbox.module.exports;
};

test('modes: only off, always and status; anything else is ignored', () => {
  const m = load();
  assert.deepEqual(Array.from(m.MODES), ['off', 'always', 'status']);
  assert.equal(m.parseMode('status'), 'status');
  for (const bad of ['', 'ON', 'config', null, undefined, 3, {}]) assert.equal(m.parseMode(bad), null);
});

test('the endpoint must be https, or http on this machine, with no credentials in it', () => {
  const m = load();
  assert.equal(m.parseApi('https://cockpit.example/api/dev-status'), 'https://cockpit.example/api/dev-status');
  assert.equal(m.parseApi('http://localhost:4000/api/dev-status'), 'http://localhost:4000/api/dev-status');
  assert.equal(m.parseApi('http://127.0.0.1:4000/api/dev-status'), 'http://127.0.0.1:4000/api/dev-status');
  for (const bad of ['http://evil.example/x', 'https://user:pw@host/x', 'javascript:alert(1)', 'ftp://h/x', 'not a url', '', 'x'.repeat(400), null]) assert.equal(m.parseApi(bad), null, String(bad));
});

test('the logo moves only when the mode says so: always, or status with an active answer; off never', () => {
  const m = load();
  assert.equal(m.moves('off', true), false);
  assert.equal(m.moves('always', false), true);
  assert.equal(m.moves('status', true), true);
  assert.equal(m.moves('status', false), false);
  assert.equal(m.moves('status', undefined), false);
});

test('only a full "an agent is working" answer counts as active', () => {
  const m = load();
  assert.equal(m.isActive({ ok: true, available: true, active: true }), true);
  for (const no of [null, undefined, {}, { ok: true, available: true, active: false }, { ok: true, available: false, active: true }, { ok: false, available: true, active: true }, { ok: true, available: true, active: 'yes' }]) assert.equal(m.isActive(no), false);
});

test("the site's own setting: mode and endpoint each read on their own, anything wrong is dropped, and nothing throws", () => {
  const m = load();
  assert.deepEqual({ ...m.parseConfig('{"mode":"status","api":"https://h.example/api/dev-status"}') }, { mode: 'status', api: 'https://h.example/api/dev-status' });
  assert.deepEqual({ ...m.parseConfig('{"mode":"always"}') }, { mode: 'always', api: null });
  assert.deepEqual({ ...m.parseConfig('{"mode":"loud","api":"http://evil.example/x"}') }, { mode: null, api: null });
  for (const bad of ['', 'not json', '[]', 'null', '"x"', '{', undefined]) assert.deepEqual({ ...m.parseConfig(bad) }, { mode: null, api: null }, String(bad));
});

test('site/logo.json ships as off with no endpoint (public); the build copies it and the page points at it', () => {
  const m = load();
  const cfg = m.parseConfig(read('site/logo.json'));
  assert.equal(JSON.parse(read('site/logo.json')).mode, 'off');
  assert.deepEqual({ ...cfg }, { mode: 'off', api: null });
  assert.match(read('site/build.mjs'), /copyFileSync\(path\.join\(HERE, 'logo\.json'\), path\.join\(out, 'logo\.json'\)\)/);
  assert.match(read('packages/docs-site/lib/pages.mjs'), /data-config="\$\{root\}logo\.json"/);
  // The browser's own choice wins over the site's, then the site's, then off (checked in the script's own resolution).
  assert.match(SCRIPT, /return parseMode\(get\(MODE_KEY\)\) \|\| site\.mode \|\| 'off';/);
  assert.match(SCRIPT, /return parseApi\(get\(API_KEY\)\) \|\| site\.api;/);
});

test('link parameters: a mode, an endpoint, an empty endpoint clears it, config opens the panel, and an invalid endpoint is dropped', () => {
  const m = load();
  assert.deepEqual({ ...m.readParams('?logo=status&logoApi=https://h.example/api/dev-status') }, { mode: 'status', api: 'https://h.example/api/dev-status', config: false, touched: true });
  assert.equal(m.readParams('?logoApi=').api, '');
  assert.equal(m.readParams('?logoApi=http://evil.example/x').api, null);
  assert.equal(m.readParams('?logo=config').config, true);
  assert.equal(m.readParams('?logo=site').mode, 'site', 'follow the site setting again');
  assert.equal(m.readParams('?logo=bogus').mode, null);
  assert.equal(m.readParams('?other=1').touched, false);
});

test('a visitor who has set nothing makes no request: no endpoint address is in the script, the markup or the styles', () => {
  const files = [SCRIPT, read('packages/docs-site/lib/pages.mjs'), read('site/assets/css/site.css')];
  for (const text of files) {
    assert.doesNotMatch(text, /sslip\.io|2-28-127-143/, 'no personal or hosted address is baked into the public site');
    assert.doesNotMatch(text, /api\/dev-status['"`]?\s*[,)]/, 'the endpoint is not a default in code');
  }
  // The only fetch is in the polling path, which needs mode `status` and a stored endpoint.
  assert.match(SCRIPT, /if \(mode\(\) !== 'status'\) return;/);
});

test('the logo: two pills with their own classes, the blue one slides 12 units under the white one only while dev status is active, and reduced motion stops it', () => {
  const pages = read('packages/docs-site/lib/pages.mjs');
  assert.match(pages, /<rect class="pill-white" x="4" y="10"[^>]*fill="currentColor"\/>/);
  assert.match(pages, /<rect class="pill-blue" x="16" y="27"[^>]*stroke="url\(#lg\)"/);
  assert.match(pages, /<script src="\$\{root\}assets\/js\/logo-status\.js" data-config="\$\{root\}logo\.json" defer><\/script>/);
  const css = read('site/assets/css/site.css');
  assert.doesNotMatch(css, /brand-trace|brand-pop|stroke-dasharray: 55 14/, 'the rolling dash is gone');
  assert.match(css, /html\[data-dev-status='active'\] \.brand-mark \.pill-blue,\s*html\[data-dev-status='ending'\] \.brand-mark \.pill-blue \{ animation: brand-stack 9s ease-in-out infinite; \}/);
  assert.match(SCRIPT, /animationiteration/, 'a quiet status lets the cycle in progress finish instead of cutting it');
  assert.match(css, /46%, 54% \{ transform: translateX\(-12px\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.brand-mark, \.brand-mark \* \{ animation: none !important; \} \}/);
  // Transform only: nothing about the stroke, size or rotation moves.
  const block = css.slice(css.indexOf('@keyframes brand-stack'), css.indexOf('.logo-panel {'));
  assert.doesNotMatch(block, /rotate|scale|stroke|opacity/);
});

test('the tab icon moves like the logo: the same rest, slide, hold, slide back, rest, and the same drawing as the static icon', () => {
  const m = load();
  const at = (p) => m.pillOffset(p * m.CYCLE_MS);
  assert.equal(at(0), 0);
  assert.equal(at(0.05), 0, 'rests at the start');
  assert.ok(at(0.27) < -5 && at(0.27) > -7, 'half way through the slide is about half the travel');
  assert.equal(at(0.5), -12, 'holds under the white pill');
  assert.ok(at(0.73) < -5 && at(0.73) > -7, 'and slides back');
  assert.equal(at(0.95), 0, 'ends at rest');
  assert.equal(m.pillOffset(m.CYCLE_MS * 3 + 100), m.pillOffset(100), 'it loops');
  let prev = at(0);
  for (let i = 1; i <= 1000; i += 1) {
    const now = at(i / 1000);
    assert.ok(Math.abs(now - prev) < 0.2, 'smooth: no jump between frames');
    prev = now;
  }
  // The frame is the static icon with only the blue pill moved.
  const pages = read('packages/docs-site/lib/pages.mjs');
  const staticIcon = decodeURIComponent(pages.match(/const FAVICON =\s*"([^"]+)"/)[1].replace('data:image/svg+xml,', ''));
  assert.equal(m.faviconSvg(0), staticIcon, 'at rest the frame IS the static icon');
  assert.match(m.faviconSvg(-12), /<rect x="4" y="27" width="28"/);
  assert.match(SCRIPT, /iconOriginal/, 'the original icon is put back once the cycle has finished');
  assert.match(SCRIPT, /prefers-reduced-motion/, 'reduced motion never animates the icon');
});
