// ci1 -- /api/line/import routes (lineImportApi.mjs) on a copy of examples/import-sample: the real engine behind HTTP, the
// plan recomputed on the server, refusals as one sentence, and nothing outside the chosen folder written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineImportRouter } from './lineImportApi.mjs';
import { createMockImport } from '../../../packages/engine/line/mockImport.mjs';
import { assertImportScan, assertImportPlan, assertImportApplyResult } from '../../../packages/engine/line/contract.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/import-sample');
const ORIGIN = 'http://localhost:3000';
const TABLE_Q = 'generic-name:src/alerts/components/Table.tsx';

async function serve(t, { ops, getRoot } = {}) {
  const dir = makeTempDir('construct-line-import-api-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  const saved = [];
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineImportRouter({ clientOrigin: ORIGIN, afterSave: (_r, f) => saved.push(f), getRoot: getRoot ?? (() => ({ ok: true, root: dir })), ...(ops ? { ops } : {}) }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line/import`;
  const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
  return { dir, base, post, saved };
}

test('folders, scan, plan and apply over HTTP: the answer reaches the plan, the import lands, App.tsx is untouched', async (t) => {
  const { dir, base, post, saved } = await serve(t);
  const folders = await (await fetch(`${base}/folders`)).json();
  assert.ok(folders.folders.some((f) => f.path === 'src/alerts'));
  const scan = await (await post('/scan', { folder: 'src/alerts' })).json();
  assertImportScan(scan);
  assert.equal(scan.questions[0].id, TABLE_Q);
  const plan = await (await post('/plan', { folder: 'src/alerts', answers: { [TABLE_Q]: 'feature:alerts' } })).json();
  assertImportPlan(plan);
  assert.ok(plan.steps.some((s) => s.args.name === 'Table' && s.tool === 'line.import.toFeature'));
  const app = fs.readFileSync(path.join(dir, 'src/App.tsx'));
  const r = await (await post('/apply', { folder: 'src/alerts', answers: { [TABLE_Q]: 'feature:alerts' }, steps: [{ tool: 'evil' }] })).json();
  assertImportApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.ok(fs.existsSync(path.join(dir, 'src/alerts/features/alerts/components/Table.tsx')));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'src/App.tsx')), app);
  assert.ok(saved.length > 0 && saved.every((f) => f.startsWith('src/alerts/')));
});

test('refusals: a folder outside the project, a foreign page, no project; each one sentence and nothing written', async (t) => {
  const { dir, post } = await serve(t);
  const before = fs.readdirSync(path.join(dir, 'src'));
  const bad = await post('/apply', { folder: '../..' });
  assert.equal(bad.status, 400);
  const b = await bad.json();
  assert.equal(b.code, 'BAD_FOLDER');
  assert.match(b.sentence, /^".*" is not a folder inside the project; .*\.$/);
  const foreign = await post('/apply', { folder: 'src/alerts' }, { origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'src')), before);
  assert.equal(fs.existsSync(path.join(dir, 'src/alerts/architecture.yml')), false);
  const none = await serve(t, { getRoot: () => ({ ok: false, error: 'No project is open; pick a project first.' }) });
  const n = await none.post('/scan', { folder: 'src/alerts' });
  assert.equal(n.status, 400);
  assert.deepEqual(await n.json(), { ok: false, sentence: 'No project is open; pick a project first.', code: 'NO_PROJECT' });
});

test('the router runs on the contract mock too (what mock mode uses)', async (t) => {
  const mock = createMockImport();
  const { post } = await serve(t, { ops: { folders: () => mock.folders(), scan: (_r, b) => mock.scan(b), plan: (_r, b) => mock.plan(b), apply: (_r, b) => mock.apply(b) } });
  assertImportScan(await (await post('/scan', { folder: 'src/alerts' })).json());
  assert.equal((await post('/scan', { folder: 'nope' })).status, 400);
});
