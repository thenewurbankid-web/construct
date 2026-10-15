// t5-3 -- the English panel: the pure half on the real englishDetail answer (packages/line-fluent/cli/english.mjs, the
// module behind `construct english` and GET /api/line/english), and a DOM render check of EnglishPanel.tsx (bundled with
// esbuild, rendered with react-dom/server; no browser): the sentence is shown, the code sits in a collapsed .pal-group.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from '../../../../../test-utils/tmpdir.mjs';
import { englishDetail } from '../../../../../packages/line-fluent/cli/english.mjs';
import { detailLabel, englishHeadline, englishStateOf } from './EnglishView.ts';

const require = createRequire(import.meta.url);
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const esbuild = require('esbuild');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '../../..');

const SOURCE = 'export function add(a, b) {\n  return a + b;\n}\n\nconst double = (x) => x * 2;\n';
const FILE = 'features/orders/math.ts';
const view = () => ({ ok: true, file: FILE, functions: englishDetail(SOURCE) });

/** EnglishPanel.tsx compiled the way Next would see it (JSX automatic, `@/` alias), React left to the client's copy. */
async function loadPanel() {
  const out = path.join(makeTempDir('t5-3-panel-'), 'EnglishPanel.mjs');
  await esbuild.build({
    entryPoints: [path.join(HERE, '../components/EnglishPanel.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    alias: { '@': CLIENT },
    external: ['react', 'react/jsx-runtime'],
    outfile: out,
    logLevel: 'silent',
  });
  // The bundle imports react from its temp folder; point it at the client's node_modules.
  const code = fs.readFileSync(out, 'utf8').replace(/from "react\/jsx-runtime"/g, `from ${JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)}`);
  fs.writeFileSync(out, code);
  return (await import(pathToFileURL(out).href)).EnglishPanel;
}
const render = async (state) => renderToStaticMarkup(createElement(await loadPanel(), { state }));

test('the answer becomes the panel state: the view, or its refusal sentence', () => {
  assert.deepEqual(englishStateOf(FILE, view()), { phase: 'ready', file: FILE, view: view() });
  assert.deepEqual(englishStateOf(FILE, { ok: false, code: 'PARSE_FAILED', sentence: 'Cockpit cannot read it.' }), { phase: 'error', file: FILE, sentence: 'Cockpit cannot read it.' });
  assert.equal(englishStateOf(FILE, null).phase, 'error');
});

test('headline counts the functions; the detail label names the function, its line and its length', () => {
  const v = view();
  assert.equal(englishHeadline(v), '2 functions in plain English.');
  assert.equal(englishHeadline({ ...v, functions: v.functions.slice(0, 1) }), '1 function in plain English.');
  assert.equal(englishHeadline({ ...v, functions: [] }), 'This file has no top-level functions to read in English.');
  assert.equal(detailLabel(v.functions[0]), 'add, line 1, 3 lines of code');
  assert.equal(detailLabel(v.functions[1]), 'double, line 5, 1 line of code');
});

test('DOM: each sentence is shown, its code sits beside it in a collapsed .pal-group', async () => {
  const html = await render({ phase: 'ready', file: FILE, view: view() });
  assert.match(html, /data-testid="line-english"/);
  assert.match(html, /<p class="le-sentence">add using a and b: return a \+ b\.<\/p>/);
  assert.match(html, /<p class="le-sentence">double using x: return x \* 2\.<\/p>/);
  const details = html.match(/<details[^>]*>/g);
  assert.equal(details.length, 2);
  for (const d of details) {
    assert.match(d, /class="pal-group le-detail"/);
    assert.doesNotMatch(d, /\sopen/, 'technical detail starts collapsed');
  }
  assert.match(html, /<pre class="le-code"><code>function add\(a, b\) \{\n  return a \+ b;\n\}<\/code><\/pre>/);
  // The sentence comes before its code in each row.
  assert.ok(html.indexOf('add using a and b') < html.indexOf('function add(a, b)'));
});

test('DOM: loading, a refusal and no file', async () => {
  assert.match(await render({ phase: 'loading', file: FILE }), /Reading features\/orders\/math\.ts\.\.\./);
  const refused = await render({ phase: 'error', file: FILE, sentence: 'There is no file features/orders/math.ts in this project.' });
  assert.match(refused, /role="alert"[^>]*>There is no file features\/orders\/math\.ts in this project\.<\/p>/);
  assert.doesNotMatch(refused, /<details/);
  assert.equal(await render({ phase: 'none' }), '');
});
