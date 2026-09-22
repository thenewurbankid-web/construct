// Record a live-preview v2 selection payload from a REAL dev build (#443).
//
//   node test-utils/preview-fixtures/capture.mjs \
//     --url http://127.0.0.1:3851/ --name next-dev --selector '[data-testid="cta"]'
//
// It starts nothing: point it at a dev server you already started (see
// ./README.md). It drives the Chromium that ui/e2e already has, installs the
// real bridge from packages/engine/previewFiber.mjs against a stand-in window
// object (the bridge refuses to run in a top-level window, and Playwright's
// page IS top-level), Alt+clicks the element, and writes what the page sent to
// test/fixtures/previewFiber/<name>.json, plus any source map it could fetch.
//
// Recorded files are inputs to test/previewFiber.recorded.test.mjs. They carry
// a `capturedFrom` block so a real capture can never be mistaken for a
// hand-written payload.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installPreviewFiberBridge, decodeMappings, parseStackFrames } from '../../packages/engine/previewFiber.mjs';

// --- source-map trimming ----------------------------------------------------
// A bundled dev build's map is megabytes; a fixture must stay readable. We keep
// only the generated lines the recorded stacks actually name (and only the
// sources those segments reference), re-encoding the mappings so the kept lines
// still decode to exactly the same original positions. `sourcesContent` and
// `names` are dropped: the resolver never reads them.
const VLQ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value) {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += VLQ[digit];
  } while (v > 0);
  return out;
}

function trimSourceMap(map, keepLines) {
  if (!map || typeof map.mappings !== 'string' || map.sections) return { map, trimmed: false };
  const decoded = decodeMappings(map.mappings);
  const usedSources = new Map();
  const lines = [];
  let prevSource = 0;
  let prevLine = 0;
  let prevColumn = 0;
  for (let i = 0; i < decoded.length; i++) {
    if (!keepLines.has(i + 1)) { lines.push(''); continue; }
    let prevColumnGen = 0;
    const parts = [];
    for (const segment of decoded[i]) {
      if (segment.sourceIndex === null) continue;
      if (!usedSources.has(segment.sourceIndex)) usedSources.set(segment.sourceIndex, usedSources.size);
      const source = usedSources.get(segment.sourceIndex);
      parts.push(
        encodeVlq(segment.generatedColumn - prevColumnGen) +
        encodeVlq(source - prevSource) +
        encodeVlq(segment.sourceLine - prevLine) +
        encodeVlq(segment.sourceColumn - prevColumn),
      );
      prevColumnGen = segment.generatedColumn;
      prevSource = source;
      prevLine = segment.sourceLine;
      prevColumn = segment.sourceColumn;
    }
    lines.push(parts.join(','));
  }
  const sources = [...usedSources.entries()].sort((a, b) => a[1] - b[1]).map(([original]) => map.sources[original]);
  return {
    map: { version: 3, sources, sourceRoot: map.sourceRoot, names: [], mappings: lines.join(';') },
    trimmed: true,
    keptLines: [...keepLines].sort((a, b) => a - b),
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT_DIR = path.join(REPO, 'test/fixtures/previewFiber');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg('url');
const name = arg('name', 'capture');
const selector = arg('selector', '[data-testid="cta"]');
// Where the app was served from, so the recorded payload can be resolved later
// exactly as the Cockpit would resolve it for an open project.
const projectRoot = arg('project-root', '/project');
if (!url) {
  console.error('usage: capture.mjs --url <dev server url> --name <fixture name> [--selector <css>]');
  process.exit(2);
}

// Playwright lives in ui/e2e, and this script is never part of `npm test`.
// In an agent worktree (`<checkout>/.claude/worktrees/<name>`) the worktree has
// no node_modules of its own, so the main checkout is tried as well.
const mainCheckout = REPO.includes('/.claude/worktrees/') ? REPO.slice(0, REPO.indexOf('/.claude/worktrees/')) : REPO;
const bases = [...new Set([path.join(REPO, 'ui/e2e/package.json'), path.join(mainCheckout, 'ui/e2e/package.json')])];
let chromium = null;
for (const base of bases) {
  try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* try the next base */ }
}
if (!chromium) {
  console.error(`playwright not resolvable from any of:\n  ${bases.join('\n  ')}\nInstall it in ui/e2e (never with npm ci from inside a worktree).`);
  process.exit(3);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector(selector, { timeout: 30_000 });

// A server-rendered page has the DOM before React has hydrated it, and a fiber
// is only attached on hydration. Wait for the key rather than record an empty
// payload and call it a limitation of the approach.
let hydrated = true;
try {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    },
    selector,
    { timeout: 30_000 },
  );
} catch {
  hydrated = false;
}

const captured = await page.evaluate(
  async ({ source, selector: sel }) => {
    const install = new Function(`return (${source});`)();
    const messages = [];
    const standIn = {
      document,
      parent: { postMessage: (m) => messages.push(m) },
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      requestAnimationFrame: null, // run hover handlers synchronously
      React: window.React,
    };
    const installed = install(standIn, { nonce: 'capture-nonce', parentOrigin: window.location.origin });
    const el = document.querySelector(sel);
    if (el) el.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true, cancelable: true }));
    return {
      installed,
      messages,
      reactVersion: (window.React && window.React.version) || null,
      userAgent: navigator.userAgent,
    };
  },
  { source: installPreviewFiberBridge.toString(), selector },
);

const select = captured.messages.find((m) => m.type === 'construct:preview:select') || null;
const frames = [];
if (select) {
  const stacks = [select.selection.stack, ...select.selection.ancestors.map((a) => a.stack)].filter(Boolean);
  for (const stack of stacks) for (const line of stack.split('\n')) frames.push(line.trim());
}

// Try to fetch a source map for every http(s) URL the stacks mention. Bundler
// pseudo-URLs (webpack-internal:///…) cannot be fetched; that is recorded too.
const urls = [...new Set(frames.map((f) => (/(https?:\/\/[^\s()]+):\d+:\d+/.exec(f) || [])[1]).filter(Boolean))];
const sourceMaps = {};
const sourceMapNotes = {};
for (const u of urls) {
  try {
    const body = await page.evaluate((target) => fetch(target).then((r) => (r.ok ? r.text() : null)), u);
    if (!body) { sourceMapNotes[u] = 'not fetchable'; continue; }
    const m = /[#@]\s*sourceMappingURL=(\S+)\s*$/m.exec(body);
    if (!m) { sourceMapNotes[u] = 'no sourceMappingURL'; continue; }
    // Recorded as { map, url } — the resolver resolves a map's relative
    // `sources` against the URL the MAP was served from, per the spec.
    if (m[1].startsWith('data:')) {
      const base64 = m[1].slice(m[1].indexOf('base64,') + 7);
      sourceMaps[u] = { map: JSON.parse(Buffer.from(base64, 'base64').toString('utf8')), url: u };
      sourceMapNotes[u] = 'inline data: URI';
      continue;
    }
    const mapUrl = new URL(m[1], u).toString();
    const mapBody = await page.evaluate((target) => fetch(target).then((r) => (r.ok ? r.text() : null)), mapUrl);
    if (mapBody) { sourceMaps[u] = { map: JSON.parse(mapBody), url: mapUrl }; sourceMapNotes[u] = mapUrl; }
    else sourceMapNotes[u] = `${mapUrl}: not fetchable`;
  } catch (e) {
    sourceMapNotes[u] = `error: ${e.message}`;
  }
}

await browser.close();

// Keep only the generated lines the recorded stacks name, so the fixture is a
// readable file rather than a megabyte of bundler output.
const trimNotes = {};
for (const [u, entry] of Object.entries(sourceMaps)) {
  const keep = new Set(parseStackFrames(frames.join('\n')).filter((f) => f.url.split('?')[0] === u.split('?')[0]).map((f) => f.line));
  if (!keep.size) continue;
  const before = JSON.stringify(entry.map).length;
  const { map, trimmed, keptLines } = trimSourceMap(entry.map, keep);
  if (!trimmed) continue;
  sourceMaps[u] = { map, url: entry.url };
  trimNotes[u] = `trimmed to generated lines ${keptLines.join(', ')} (${before} -> ${JSON.stringify(map).length} bytes); sourcesContent and names dropped`;
}

const record = {
  capturedFrom: {
    what: 'a real dev build, recorded by test-utils/preview-fixtures/capture.mjs',
    url,
    selector,
    projectRoot,
    when: new Date().toISOString().slice(0, 10),
    reactVersion: captured.reactVersion,
    userAgent: captured.userAgent,
    note: arg('note', null),
  },
  installed: captured.installed,
  hydrated,
  messages: captured.messages,
  stackFrames: frames,
  sourceMaps,
  sourceMapNotes,
  sourceMapTrimmed: trimNotes,
  pageErrors: consoleErrors,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `${name}.json`);
fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(`recorded ${captured.messages.length} message(s) to ${path.relative(REPO, out)}`);
if (select) {
  console.log(`  component: ${select.selection.componentName}`);
  console.log(`  ancestors: ${select.selection.ancestors.map((a) => a.componentName).join(' < ') || '(none)'}`);
  console.log(`  evidence:  debugSource=${!!select.selection.debugSource} debugStack=${!!select.selection.stack}`);
  console.log(`  maps:      ${Object.keys(sourceMaps).length} fetched of ${urls.length} url(s)`);
} else {
  console.log('  NO SELECTION — the bridge found no fiber on that element.');
}
