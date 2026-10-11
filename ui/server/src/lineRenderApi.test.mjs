// T7 -- GET /api/line/render (lineRenderApi.mjs over packages/engine/line/renderComponent.mjs) on a copy of
// examples/line-sample. The Morpheus link is injected: a mock that is up (a tiny string renderer built with esbuild,
// no React), a mock that is down, and last the real link when this machine has it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { build } from 'esbuild';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineRenderRouter } from './lineRenderApi.mjs';
import { importLinked } from '../../../packages/line-links/index.mjs';
import { sampleProps } from '../../../packages/engine/line/renderComponent.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');

/** A Morpheus-shaped module that is up: renderPage(tsx) bundles the page with a string JSX factory and returns a document. */
const H = `const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export const Fragment = (p) => p.children;
const kids = (c) => c.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false).map((x) => (x && x.__html !== undefined ? x.__html : esc(x))).join('');
export function h(tag, props, ...children) {
  if (typeof tag === 'function') { const out = tag({ ...(props || {}), children }); return out && out.__html !== undefined ? out : { __html: kids([out]) }; }
  const attrs = Object.entries(props || {}).map(([k, v]) => \` \${k === 'className' ? 'class' : k}="\${esc(v)}"\`).join('');
  return { __html: \`<\${tag}\${attrs}>\${kids(children)}</\${tag}>\` };
}`;
function mockUp(calls = []) {
  return async () => ({
    ok: true,
    module: {
      async renderPage(tsx, { scratch, title }) {
        calls.push({ tsx, scratch });
        const work = fs.mkdtempSync(path.join(scratch, 'mock-'));
        fs.writeFileSync(path.join(work, 'h.js'), H);
        fs.writeFileSync(path.join(work, 'page.tsx'), tsx);
        await build({ entryPoints: [path.join(work, 'page.tsx')], bundle: true, format: 'esm', platform: 'node', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment', inject: [path.join(work, 'h.js')], outfile: path.join(work, 'page.mjs'), logLevel: 'silent' });
        const Page = (await import(pathToFileURL(path.join(work, 'page.mjs')).href)).default;
        return `<!doctype html>\n<html><head><title>${title}</title></head><body>${Page().__html}</body></html>\n`;
      },
    },
  });
}
const LINK_DOWN_REASON = '@mx/morpheus-render is not linked because the source folder /nowhere is missing, so Construct uses its static path.';
const mockDown = async () => ({ ok: false, reason: LINK_DOWN_REASON });

async function serve(t, deps) {
  const dir = makeTempDir('construct-line-render-api-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  const app = express();
  app.use('/api/line', createLineRenderRouter({ getRoot: () => ({ ok: true, root: dir }), deps }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const get = async (file, props) => {
    const q = new URLSearchParams({ file, ...(props === undefined ? {} : { props: typeof props === 'string' ? props : JSON.stringify(props) }) });
    const res = await fetch(`${base}/render?${q}`);
    return { status: res.status, body: await res.json() };
  };
  return { dir, get };
}

/** Every file under `dir` with its contents, to prove a render wrote nothing. */
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).map(String).sort().filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

test('samples: text from the prop name, 1 for a number, false for a boolean, the first literal of a union, a fixture value wins', () => {
  const described = [{ name: 'label', type: 'string' }, { name: 'userName', type: 'string' }, { name: 'count', type: 'number' }, { name: 'open', type: 'boolean' }, { name: 'tone', type: "'primary' | 'ghost'" }, { name: 'onClick', type: '() => void' }];
  assert.deepEqual(sampleProps(described).map((p) => [p.name, p.kind, p.value]), [
    ['label', 'string', 'Label'], ['userName', 'string', 'User name'], ['count', 'number', 1], ['open', 'boolean', false], ['tone', 'string', 'primary'], ['onClick', 'other', null],
  ]);
  assert.equal(sampleProps(described, { label: 'From fixture' })[0].value, 'From fixture');
});

test('link up: the Button renders with its sample label, its props are listed, and nothing is written to the project', async (t) => {
  const calls = [];
  const { dir, get } = await serve(t, { loadMorpheus: mockUp(calls) });
  const before = snapshot(dir);
  const { status, body } = await get('library/components/Button.tsx');
  assert.equal(status, 200);
  assert.equal(body.ok, true, body.sentence);
  assert.equal(body.via, 'morpheus');
  assert.match(body.html, /<button type="button">Label<\/button>/);
  assert.deepEqual(body.props, [{ name: 'label', type: 'string', kind: 'string', value: 'Label' }]);
  assert.deepEqual(snapshot(dir), before, 'a render is a pure read');
  assert.equal(fs.existsSync(calls[0].scratch), false, 'the render folder is removed afterwards');
  assert.equal(path.relative(dir, calls[0].scratch).startsWith('..'), true, 'the render folder is outside the project');
});

test('link up: a changed prop value re-renders with it; a molecule renders its library atoms; a fixture gives the sample', async (t) => {
  const { dir, get } = await serve(t, { loadMorpheus: mockUp() });
  const changed = await get('library/components/Button.tsx', { label: 'Buy now' });
  assert.match(changed.body.html, /<button type="button">Buy now<\/button>/);
  assert.equal(changed.body.props[0].value, 'Buy now');
  const table = await get('library/components/DataTable.tsx', { count: 3 });
  assert.equal(table.body.ok, true, table.body.sentence);
  assert.match(table.body.html, /<h2>Title<\/h2><button type="button">Refresh<\/button><\/section><span class="badge">3 rows<\/span>/);
  fs.writeFileSync(path.join(dir, 'library/fixtures/Badge.json'), JSON.stringify({ text: 'Paid' }));
  const badge = await get('library/components/Badge.tsx');
  assert.match(badge.body.html, /<span class="badge">Paid<\/span>/);
});

test('link down: one plain sentence that there is no picture and the rest of Cockpit works, the props still listed', async (t) => {
  const { get } = await serve(t, { loadMorpheus: mockDown });
  const { status, body } = await get('library/components/Button.tsx');
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'NO_RENDERER');
  assert.equal(body.sentence, "There is no picture of Button because Morpheus's renderer is not linked here and Construct's own preview needs the project's dev server, so only its props are listed; the rest of Cockpit works as usual.");
  assert.equal(body.sentence.split(/[.?!](\s|$)/).filter((s) => s && s.trim()).length, 1, 'one sentence');
  assert.equal(body.detail, LINK_DOWN_REASON, 'the technical reason is kept apart');
  assert.deepEqual(body.props.map((p) => p.name), ['label']);
});

test('refusals: outside <library>/components, a traversal, a missing file and bad props are a 400 with one sentence and no render', async (t) => {
  let loads = 0;
  const { get } = await serve(t, { loadMorpheus: async () => { loads += 1; return mockDown(); } });
  for (const file of ['library/pages/ListPage.tsx', 'features/orders/components/OrderButton.tsx', 'library/components/../pages/ListPage.tsx', '/etc/passwd', '../outside/library/components/X.tsx', '']) {
    const { status, body } = await get(file);
    assert.equal(status, 400, file);
    assert.equal(body.code, 'OUTSIDE_LIBRARY', file);
    assert.match(body.sentence, /^Only components in library\/components\/ can be previewed here, so ".*" is not shown\.$/);
  }
  assert.equal((await get('library/components/Nope.tsx')).body.code, 'NOT_FOUND');
  assert.equal((await get('library/components/Button.tsx', '[1]')).body.code, 'BAD_PROPS');
  assert.equal((await get('library/components/Button.tsx', { label: { x: 1 } })).body.code, 'BAD_PROPS');
  const unknown = await get('library/components/Button.tsx', { colour: 'red' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.sentence, 'Button has no prop called "colour", so nothing was rendered.');
  assert.equal(loads, 0, 'a refused request never reaches the renderer');
});

test('a symlink inside library/components that points out of it is refused', async (t) => {
  const { dir, get } = await serve(t, { loadMorpheus: mockUp() });
  fs.symlinkSync(path.join(dir, 'features/orders/components/OrderButton.tsx'), path.join(dir, 'library/components/Sneaky.tsx'));
  const { status, body } = await get('library/components/Sneaky.tsx');
  assert.equal(status, 400);
  assert.equal(body.code, 'OUTSIDE_LIBRARY');
});

test('real Morpheus link: the sample Button renders to a themed document with the new label', async (t) => {
  const link = await importLinked('@mx/morpheus-render');
  if (!link.ok) return t.skip(link.reason);
  const { get } = await serve(t, {});
  const { body } = await get('library/components/Button.tsx', { label: 'Buy now' });
  assert.equal(body.ok, true, body.detail ?? body.sentence);
  assert.match(body.html, /^<!doctype html>/);
  assert.match(body.html, /<title>Button<\/title>/);
  assert.match(body.html, /<button type="button">Buy now<\/button>/);
});
