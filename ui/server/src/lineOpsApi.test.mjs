// T4 -- /api/line write routes (lineOpsApi.mjs) on a copy of examples/line-sample: the real engine operations behind
// HTTP, refusals as one sentence, and nothing written unless Construct's writer lets the change land.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineOpsRouter } from './lineOpsApi.mjs';
import { assertApplyResult, assertLineWorkspace } from '../../../packages/engine/line/contract.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');
const ORIGIN = 'http://localhost:3000';

async function serve(t, { root = null, saved = [] } = {}) {
  const dir = root ?? makeTempDir('construct-line-ops-api-');
  if (!root) fs.cpSync(SAMPLE, dir, { recursive: true });
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineOpsRouter({ clientOrigin: ORIGIN, afterSave: (_r, f) => saved.push(f), getRoot: () => ({ ok: true, root: dir }) }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
  return { dir, base, post, saved };
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('page tree and set a prop: the parts come back, and a title change lands through the writer', async (t) => {
  const { dir, base, post, saved } = await serve(t);
  const file = 'features/orders/pages/OrdersPage.tsx';
  const tree = await (await fetch(`${base}/page-tree?file=${encodeURIComponent(file)}`)).json();
  assert.equal(tree.feature, 'orders');
  const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children)]);
  const node = all(tree.roots).find((n) => n.props.some((p) => p.name === 'title'));
  assert.ok(node, 'the page has a part with a title');
  const res = await post('/page-prop', { file, nodeId: node.id, prop: 'title', kind: 'string', value: 'All orders' });
  const body = await res.json();
  assertApplyResult(body);
  assert.equal(body.ok, true, body.sentence);
  assert.match(read(dir, file), /title="All orders"/);
  assert.deepEqual(saved, [file]);
});

test('base on a library item lands a new feature file; promote moves OrderButton into the library and fixes the planted cross-feature import', async (t) => {
  const { dir, post } = await serve(t);
  const r = await (await post('/base-on', { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' })).json();
  assertApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.match(read(dir, 'features/orders/components/StatusBadge.tsx'), /^\/\/ @line-base components\/Badge/);
  const p = await (await post('/promote', { featureItemId: 'orders/components/OrderButton' })).json();
  assertApplyResult(p);
  assert.equal(p.ok, true, p.sentence);
  assert.ok(fs.existsSync(path.join(dir, 'library/components/OrderButton.tsx')));
  assert.equal(fs.existsSync(path.join(dir, 'features/orders/components/OrderButton.tsx')), false);
  assert.doesNotMatch(read(dir, 'features/billing/pages/InvoicesPage.tsx'), /features\/orders|\.\.\/\.\.\/orders/, 'the planted cross-feature import now points at the library');
});

test('refusals are one sentence with a code, and change nothing', async (t) => {
  const { dir, base, post } = await serve(t);
  const before = read(dir, 'features/orders/pages/OrdersPage.tsx');
  const unknown = await post('/base-on', { libraryId: 'components/Nope', feature: 'orders', name: 'X' });
  assert.equal(unknown.status, 400);
  const u = await unknown.json();
  assert.equal(u.code, 'UNKNOWN_ITEM');
  assert.match(u.sentence, /^There is no library item/);
  const missing = await fetch(`${base}/page-tree?file=${encodeURIComponent('features/orders/pages/Nope.tsx')}`);
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, 'UNKNOWN_ITEM');
  const foreign = await post('/page-prop', {}, { origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(read(dir, 'features/orders/pages/OrdersPage.tsx'), before);
});

test('with no project open, every route says so in one sentence', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineOpsRouter({ clientOrigin: ORIGIN, getRoot: () => ({ ok: false, error: 'No project is open; pick a project first.' }) }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line/page-tree?file=x`);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, sentence: 'No project is open; pick a project first.', code: 'NO_PROJECT' });
});

test('workspace: GET says the whole project until one is set; POST sets features/orders, base-on into billing is refused in one sentence, into orders lands', async (t) => {
  const { dir, base, post } = await serve(t);
  const w0 = await (await fetch(`${base}/workspace`)).json();
  assertLineWorkspace(w0);
  assert.equal(w0.folder, '');
  const w = await (await post('/workspace', { folder: 'features/orders' })).json();
  assertLineWorkspace(w);
  assert.equal(w.folder, 'features/orders');
  assert.equal((await (await fetch(`${base}/workspace`)).json()).folder, 'features/orders');
  assert.deepEqual(JSON.parse(read(dir, 'line/workspace.json')), { folder: 'features/orders' });
  const refused = await (await post('/base-on', { libraryId: 'components/Badge', feature: 'billing', name: 'PaidBadge' })).json();
  assertApplyResult(refused);
  assert.equal(refused.code, 'OUTSIDE_WORKSPACE');
  assert.equal(refused.sentence, 'Nothing was saved: features/billing/components/PaidBadge.tsx is outside your workspace folder features/orders; it stays read-only.');
  assert.equal(fs.existsSync(path.join(dir, 'features/billing/components/PaidBadge.tsx')), false);
  const landed = await (await post('/base-on', { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' })).json();
  assert.equal(landed.ok, true, landed.sentence);
});

test('workspace: a folder outside the project is a 400 with one sentence, and nothing is stored', async (t) => {
  const { dir, post } = await serve(t);
  const res = await post('/workspace', { folder: '../../outside' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'BAD_FOLDER');
  assert.match(body.sentence, /^".*" is not a folder inside the project; pick one from the project's folders\.$/);
  assert.equal(fs.existsSync(path.join(dir, 'line/workspace.json')), false);
});
