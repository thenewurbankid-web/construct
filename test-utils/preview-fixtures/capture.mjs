// Record a live-preview v2 selection payload from a REAL dev build (#443).
//
//   node test-utils/preview-fixtures/capture.mjs \
//     --url http://127.0.0.1:3851/ --name next-dev --selector '[data-testid="cta"]'
//
// It starts nothing: point it at a dev server you already started (see
// ./README.md). It drives the Chromium that ui/e2e already has, installs the
// real bridge from src/engine/previewFiber.mjs against a stand-in window
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
import { installPreviewFiberBridge } from '../../src/engine/previewFiber.mjs';

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

// Playwright lives in ui/e2e; this script is never part of `npm test`.
const require = createRequire(path.join(REPO, 'ui/e2e/package.json'));
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector(selector, { timeout: 30_000 });

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
    if (m[1].startsWith('data:')) {
      const base64 = m[1].slice(m[1].indexOf('base64,') + 7);
      sourceMaps[u] = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      sourceMapNotes[u] = 'inline data: URI';
      continue;
    }
    const mapUrl = new URL(m[1], u).toString();
    const mapBody = await page.evaluate((target) => fetch(target).then((r) => (r.ok ? r.text() : null)), mapUrl);
    if (mapBody) { sourceMaps[u] = JSON.parse(mapBody); sourceMapNotes[u] = mapUrl; }
    else sourceMapNotes[u] = `${mapUrl}: not fetchable`;
  } catch (e) {
    sourceMapNotes[u] = `error: ${e.message}`;
  }
}

await browser.close();

const record = {
  capturedFrom: {
    what: 'a real dev build, recorded by test-utils/preview-fixtures/capture.mjs',
    url,
    selector,
    projectRoot,
    when: new Date().toISOString().slice(0, 10),
    reactVersion: captured.reactVersion,
    userAgent: captured.userAgent,
  },
  installed: captured.installed,
  messages: captured.messages,
  stackFrames: frames,
  sourceMaps,
  sourceMapNotes,
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
