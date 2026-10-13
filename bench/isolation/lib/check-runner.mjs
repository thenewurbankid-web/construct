// Runs one task's deterministic DOM/unit check against a built workspace, in its own process
// (fresh module state, fresh jsdom, fresh localStorage). Prints one JSON line: { ok, failures, error? }.
//
//   node bench/isolation/lib/check-runner.mjs <workspaceDir> <taskDir>
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [ws, taskDir] = process.argv.slice(2).map((p) => resolve(p));
const task = JSON.parse(readFileSync(join(taskDir, 'task.json'), 'utf8'));

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis;
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  try { Object.defineProperty(g, key, { value: dom.window[key], configurable: true, writable: true }); } catch {}
}
g.IS_REACT_ACT_ENVIRONMENT = true;
// React logs act/hydration noise to console.error; keep stdout clean for the JSON line.
console.error = () => {};
console.warn = () => {};

const out = (obj) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(0); };

try {
  // One bundle so the page and the store share a single module instance (the check reads the store the page wrote).
  const outDir = join(ws, '.out');
  mkdirSync(outDir, { recursive: true });
  const entry = join(outDir, 'entry.ts');
  writeFileSync(entry, Object.entries(task.entries).map(([k, p]) => `export * as ${k} from ${JSON.stringify(join(ws, p))};`).join('\n') + '\n');
  await build({
    entryPoints: [entry], outfile: join(outDir, 'entry.mjs'), bundle: true, format: 'esm', platform: 'node',
    jsx: 'automatic', external: ['react', 'react-dom', 'react/*', 'react-dom/*', '@radix-ui/*', 'jsdom'],
    alias: { 'next/link': join(ws, 'shims/next-link.tsx'), '@line/construct-core/typed-contracts': join(ws, 'typed-contracts/index.ts'), '@smith/core': join(ws, 'smith-core/index.ts') }, logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(join(outDir, 'entry.mjs')).href);
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = React;

  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const t = {
    mod, h: React.createElement, books: JSON.parse(readFileSync(join(ws, 'library/fixtures/books.json'), 'utf8')),
    component() {
      const page = mod.page ?? {};
      const name = basename(task.entries.page ?? '', extname(task.entries.page ?? ''));
      return page[name] ?? page.default ?? Object.values(page).find((v) => typeof v === 'function');
    },
    async render(el) {
      document.body.innerHTML = '';
      const c = document.createElement('div');
      document.body.appendChild(c);
      const root = createRoot(c);
      await act(async () => { root.render(el); });
      return c;
    },
    async click(node) { await act(async () => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); },
    async change(select, value) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
        setter.call(select, value);
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
    },
    text: (node) => norm(node.textContent),
    // #943: a page reads data only through a feature service (owner rule); the check fails a page that imports a fixture
    readsFixture: () => /from\s+['"][^'"]*fixtures\/[^'"]+\.json['"]/.test(readFileSync(join(ws, task.target), 'utf8')),
    norm,
    buttons: (c, name) => [...c.querySelectorAll('button')].filter((b) => norm(b.textContent) === name || b.getAttribute('aria-label') === name),
    links: (c) => [...c.querySelectorAll('a[href]')],
    byLabel(c, name) {
      const label = [...c.querySelectorAll('label')].find((l) => norm(l.textContent) === name);
      if (label) {
        const forId = label.getAttribute('for');
        if (forId) return c.querySelector(`#${CSS.escape ? CSS.escape(forId) : forId}`) ?? document.getElementById(forId);
        return label.querySelector('select,input,textarea');
      }
      return c.querySelector(`[aria-label="${name}"]`);
    },
  };
  g.CSS = dom.window.CSS ?? { escape: (s) => s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`) };

  const check = (await import(pathToFileURL(join(taskDir, 'check.mjs')).href)).default;
  const failures = [];
  try {
    await check(t, (msg) => failures.push(msg));
  } catch (err) {
    failures.push(`check threw: ${String(err?.message ?? err).split('\n')[0]}`);
  }
  out({ ok: failures.length === 0, failures });
} catch (err) {
  out({ ok: false, failures: [`build/load failed: ${String(err?.message ?? err).split('\n').slice(0, 3).join(' | ')}`] });
}
