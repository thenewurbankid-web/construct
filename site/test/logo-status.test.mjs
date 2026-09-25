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

test("the site's own setting: mode, endpoint and motion each read on their own, anything wrong is dropped, and nothing throws", () => {
  const m = load();
  const lab = { mark: 'line', parts: { white: 'pos', blue: 'neg' }, effect: 'slide', distance: 6, durationSeconds: 5 };
  const ok = m.parseConfig(JSON.stringify({ mode: 'status', api: 'https://h.example/api/dev-status', motion: lab }));
  assert.equal(ok.mode, 'status');
  assert.equal(ok.api, 'https://h.example/api/dev-status');
  assert.equal(ok.motion.duration, 5);
  assert.deepEqual({ ...m.parseConfig('{"mode":"always"}') }, { mode: 'always', api: null, motion: null });
  assert.deepEqual({ ...m.parseConfig('{"mode":"loud","api":"http://evil.example/x","motion":{"mark":"cockpit"}}') }, { mode: null, api: null, motion: null });
  for (const bad of ['', 'not json', '[]', 'null', '"x"', '{', undefined]) assert.deepEqual({ ...m.parseConfig(bad) }, { mode: null, api: null, motion: null }, String(bad));
});

test('the site setting follows the live Cockpit status endpoint; the build copies it and still publishes the activity file', () => {
  const m = load();
  const cfg = m.parseConfig(read('site/logo.json'));
  const setting = JSON.parse(read('site/logo.json'));
  assert.equal(setting.mode, 'status');
  assert.equal(setting.api, 'https://2-28-127-143.sslip.io/api/dev-status');
  assert.equal(setting.motion.preset, 'Slide under', "the Logo Lab's shipping motion for the docs header");
  assert.equal(cfg.mode, 'status');
  assert.equal(cfg.api, 'https://2-28-127-143.sslip.io/api/dev-status');
  assert.notEqual(cfg.motion, null, "the site's motion parses");
  assert.match(read('site/build.mjs'), /copyFileSync\(path\.join\(HERE, 'logo\.json'\), path\.join\(out, 'logo\.json'\)\)/);
  assert.match(read('site/build.mjs'), /path\.join\(out, 'dev-status\.json'\)/);
  assert.match(read('packages/docs-site/lib/pages.mjs'), /data-config="\$\{root\}logo\.json"/);
  // The browser's own choice wins over the site's, then the site's, then off (checked in the script's own resolution).
  assert.match(SCRIPT, /return parseMode\(get\(MODE_KEY\)\) \|\| site\.mode \|\| 'off';/);
  assert.match(SCRIPT, /return parseApi\(get\(API_KEY\)\) \|\| site\.api;/);
});

test('the site setting may name a RELATIVE path on the site itself; nothing that leaves the site, and the absolute rules are unchanged', () => {
  const m = load();
  for (const ok of ['dev-status.json', 'status/dev-status.json', 'dev-status.json?v=1']) assert.equal(m.parseRelativeApi(ok), ok, ok);
  for (const bad of ['../x', 'a/../x', './x', '/x', '//host/x', '\\\\host\\x', 'https://h.example/x', 'javascript:alert(1)', 'data:text/plain,x', 'a b', 'a#b', '', 'x'.repeat(300), null, 3, undefined]) assert.equal(m.parseRelativeApi(bad), null, String(bad));
  // parseApi is untouched: it still refuses a relative path (the browser's own endpoint and ?logoApi= stay absolute).
  assert.equal(m.parseApi('dev-status.json'), null);
  assert.equal(m.parseApi('http://evil.example/x'), null);
  // In the site's own setting both kinds are read, and a bad one is dropped.
  assert.equal(m.parseConfig('{"api":"dev-status.json"}').api, 'dev-status.json');
  assert.equal(m.parseConfig('{"api":"https://h.example/api/dev-status"}').api, 'https://h.example/api/dev-status');
  for (const bad of ['../x', '//host/x', 'http://evil.example/x', '/abs']) assert.equal(m.parseConfig(JSON.stringify({ api: bad })).api, null, bad);
  assert.match(SCRIPT, /new URL\(api, new URL\(configUrl \|\| '', window\.location\.href\)\)/, 'a relative source is resolved next to logo.json');
});

test("an activity file counts as active while it is younger than its window, on the visitor's clock", () => {
  const m = load();
  const NOW = Date.parse('2026-09-25T12:00:00Z');
  const at = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
  assert.equal(m.isActive({ lastActivityAt: at(60), windowSec: 900 }, NOW), true, 'fresh');
  assert.equal(m.isActive({ lastActivityAt: at(899), windowSec: 900 }, NOW), true, 'just inside');
  assert.equal(m.isActive({ lastActivityAt: at(900), windowSec: 900 }, NOW), false, 'exactly the window is stale');
  assert.equal(m.isActive({ lastActivityAt: at(3600), windowSec: 900 }, NOW), false, 'stale');
  assert.equal(m.isActive({ lastActivityAt: at(-3600), windowSec: 900 }, NOW), true, 'a time in the future (clock skew) is age 0');
  assert.equal(m.isActive({ lastActivityAt: at(600) }, NOW), true, 'no windowSec: 900 s');
  assert.equal(m.isActive({ lastActivityAt: at(1000) }, NOW), false, 'no windowSec: 900 s');
  assert.equal(m.isActive({ lastActivityAt: at(1000), windowSec: 'long' }, NOW), false, 'a silly windowSec falls back to 900 s');
  assert.equal(m.isActive({ lastActivityAt: at(1000), windowSec: -5 }, NOW), false);
  assert.equal(m.isActive({ lastActivityAt: at(1000), windowSec: 1800 }, NOW), true, 'a longer window is honoured');
  for (const no of [{ lastActivityAt: null, windowSec: 900 }, { lastActivityAt: 'garbage' }, { lastActivityAt: '' }, { lastActivityAt: 12345 }, { lastActivityAt: {} }, { windowSec: 900 }]) assert.equal(m.isActive(no, NOW), false, JSON.stringify(no));
  // The endpoint shape still works, and an activity file does not need to say ok/available.
  assert.equal(m.isActive({ ok: true, available: true, active: true }, NOW), true);
  assert.equal(m.isActive({ ok: true, available: true, active: false }, NOW), false);
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
  const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, ''); // the header comment shows an example address; only code counts
  const files = [code, read('packages/docs-site/lib/pages.mjs'), read('site/assets/css/site.css')];
  for (const text of files) {
    assert.doesNotMatch(text, /sslip\.io|2-28-127-143/, 'no personal or hosted address is baked into the public site');
    assert.doesNotMatch(text, /api\/dev-status['"`]?\s*[,)]/, 'the endpoint is not a default in code');
  }
  // The only fetch is in the polling path, which needs mode `status` and a stored endpoint.
  assert.match(SCRIPT, /if \(mode\(\) !== 'status'\) return;/);
});

test('the logo: two pills with their own classes, the script installs the keyframes, nothing animates in the stylesheet, and reduced motion stops it', () => {
  const pages = read('packages/docs-site/lib/pages.mjs');
  assert.match(pages, /<rect class="pill-white" x="4" y="10"[^>]*fill="currentColor"\/>/);
  assert.match(pages, /<rect class="pill-blue" x="16" y="27"[^>]*stroke="url\(#lg\)"/);
  assert.match(pages, /<script src="\$\{root\}assets\/js\/logo-status\.js" data-config="\$\{root\}logo\.json" defer><\/script>/);
  const css = read('site/assets/css/site.css');
  assert.doesNotMatch(css, /brand-trace|brand-pop|brand-stack|stroke-dasharray: 55 14|@keyframes logo-/, 'the stylesheet carries no fixed animation');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.brand-mark, \.brand-mark \* \{ animation: none !important; \} \}/);
  assert.match(SCRIPT, /styleEl\.id = 'logo-motion'/);
  assert.match(SCRIPT, /animationiteration/, 'a quiet status lets the cycle in progress finish instead of cutting it');
});

test('the built-in motion is the Handshake: both pills 6 units toward each other (they share a column), 6.6 s, holds, parts, rests', () => {
  const m = load();
  const S = m.parseMotion(m.DEFAULT_MOTION_JSON);
  assert.equal(S.duration, 6.6);
  assert.deepEqual({ ...S.parts }, { white: 'pos', blue: 'neg' });
  const at = (pct) => m.motionAt(S, (pct / 100) * S.duration * 1000);
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
  near(at(0).white.x, 0, 'starts at rest');
  near(at(0).blue.x, 0, 'starts at rest');
  near(at(19).white.x, 6, 'white is 6 right after the move in');
  near(at(19).blue.x, -6, 'blue is 6 left');
  near(at(33).white.x, 6, 'holds while stacked');
  near(at(47).blue.x, -6, 'still held at 47%');
  assert.ok(at(10).white.x > 1 && at(10).white.x < 5, 'moving in at 10%');
  assert.ok(at(60).white.x > 0 && at(60).white.x < 6, 'parting at 60%');
  near(at(66).white.x, 0, 'back at rest at 66%');
  near(at(80).white.x, 0, 'rests for the last third');
  assert.equal(m.atRest(at(80)), true);
  assert.equal(m.atRest(at(10)), false);
  // The white pill (x 4-32, 12 apart from the blue at 16-44) and the blue one land on the same column: 4+6 = 16-6.
  near(4 + at(33).white.x, 16 + at(33).blue.x, 'the pills stack in one column');
});

test('the keyframes the script installs are generated from the same motion: timing, distances, easing and reduced-motion-safe selectors', () => {
  const m = load();
  const css = m.motionCss(m.parseMotion(m.DEFAULT_MOTION_JSON));
  assert.match(css, /html\[data-dev-status='active'\] \.brand-mark \.pill-white, html\[data-dev-status='ending'\] \.brand-mark \.pill-white \{ animation: logo-white 6\.6s infinite; \}/);
  assert.match(css, /html\[data-dev-status='active'\] \.brand-mark \.pill-blue, html\[data-dev-status='ending'\] \.brand-mark \.pill-blue \{ animation: logo-blue 6\.6s infinite; \}/);
  assert.match(css, /@keyframes logo-white \{[\s\S]*19%, 47% \{ transform: translate\(6px, 0px\); animation-timing-function: ease-in-out; \}/, 'in by 19%, held until 47%');
  assert.match(css, /@keyframes logo-blue \{[\s\S]*19%, 47% \{ transform: translate\(-6px, 0px\); animation-timing-function: ease-in-out; \}/);
  assert.match(css, /66%, 100% \{ transform: translate\(0px, 0px\)/, 'back at rest by 66%, resting to the end');
  assert.doesNotMatch(css, /scale\(|opacity:/, 'a slide moves nothing but position');
});

test("a Logo Lab export is read as it comes: other effects, stagger and easing all become keyframes; a motion for another mark, or one that moves nothing, is refused", () => {
  const m = load();
  const breathe = m.parseMotion({ mark: 'line', parts: { white: 'still', blue: 'pos' }, effect: 'pulse', distance: 4, durationSeconds: 4, restBeforePct: 0, restAfterPct: 0, holdPct: 0, beats: 1, easing: { type: 'ease-in-out' }, staggerPct: 0, direction: 'out-and-back' });
  const css = m.motionCss(breathe);
  assert.match(css, /scale\(1\.12\)/);
  assert.match(css, /opacity: 0\.76/);
  assert.doesNotMatch(css, /pill-white \{ animation|logo-white/, 'a pill that stays still gets no animation');
  const ripple = m.parseMotion({ mark: 'line', parts: { white: 'pos', blue: 'pos' }, effect: 'pulse', distance: 5, durationSeconds: 2.4, staggerPct: 18, easing: { type: 'steps', count: 4 } });
  assert.match(m.motionCss(ripple), /animation-delay: 0\.432s/);
  assert.match(m.motionCss(ripple), /steps\(4, end\)/);
  assert.equal(m.parseMotion({ mark: 'cockpit', parts: { ring: 'still', bar: 'pos', knob: 'neg' } }), null, 'the Cockpit mark is not the docs logo');
  assert.equal(m.parseMotion({ mark: 'line', parts: { white: 'still', blue: 'still' } }), null, 'nothing moves');
  assert.equal(m.parseMotion('not json'), null);
  const clamped = m.parseMotion({ parts: { blue: 'neg' }, distance: 999, durationSeconds: -3, restBeforePct: 500, beats: 99 });
  assert.equal(clamped.distance, 30);
  assert.equal(clamped.duration, 0.3);
  assert.equal(clamped.rb, 90);
  assert.equal(clamped.beats, 4);
  assert.equal(m.parseMotion({ mark: 'line', parts: { blue: 'neg' }, effect: 'nonsense', axis: 'q' }).fx, 'slide');
});

test('the tab icon is drawn from the same motion: at rest it IS the static icon, moved frames move the same pills the same way, and it never jumps', () => {
  const m = load();
  const S = m.parseMotion(m.DEFAULT_MOTION_JSON);
  const cycle = S.duration * 1000;
  const pages = read('packages/docs-site/lib/pages.mjs');
  const staticIcon = decodeURIComponent(pages.match(/const FAVICON =\s*"([^"]+)"/)[1].replace('data:image/svg+xml,', ''));
  assert.equal(m.faviconSvg(m.motionAt(S, 0)), staticIcon, 'at rest the frame IS the static icon');
  assert.equal(m.faviconSvg(), staticIcon);
  const stacked = m.faviconSvg(m.motionAt(S, 0.3 * cycle));
  assert.match(stacked, /<rect x="4" y="10"[^>]*transform="translate\(6 0\)"\/>/);
  assert.match(stacked, /<rect x="16" y="27"[^>]*transform="translate\(-6 0\)"\/>/);
  assert.equal(m.motionAt(S, cycle * 5 + 1000).white.x, m.motionAt(S, 1000).white.x, 'it loops on the clock');
  let prev = m.motionAt(S, 0);
  for (let t = 20; t <= cycle; t += 20) {
    const now = m.motionAt(S, t);
    assert.ok(Math.abs(now.white.x - prev.white.x) < 0.5 && Math.abs(now.blue.x - prev.blue.x) < 0.5, `no jump at ${t} ms`);
    prev = now;
  }
  assert.match(SCRIPT, /iconOriginal/, 'the original icon is put back once the cycle has finished');
  assert.match(SCRIPT, /prefers-reduced-motion/, 'reduced motion never animates the icon');
});
