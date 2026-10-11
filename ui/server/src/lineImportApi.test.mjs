// ci1 -- /api/line/import routes (lineImportApi.mjs) on a copy of examples/import-sample: the real engine behind HTTP,
// refusals as one sentence, and nothing outside the chosen folder written. Since the integration with cp1 (11 Oct) the
// import lands as plan steps (/api/line/plan: line.import.* tools, one approval for all of them), not /import/apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineImportRouter } from './lineImportApi.mjs';
import { createLinePlanRouter } from './linePlanApi.mjs';
import { createLinePlanService, loadPlanApi } from '../../../packages/engine/line/planService.mjs';
import { createMockImport } from '../../../packages/engine/line/mockImport.mjs';
import { assertImportScan, assertImportPlan } from '../../../packages/engine/line/contract.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/import-sample');
const ORIGIN = 'http://localhost:3000';
const TABLE_Q = 'generic-name:src/alerts/components/Table.tsx';
const NO_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };

async function serve(t, { ops, getRoot } = {}) {
  const dir = makeTempDir('construct-line-import-api-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  const saved = [];
  const app = express();
  app.use(express.json());
  app.use('/api/line', createLineImportRouter({ clientOrigin: ORIGIN, getRoot: getRoot ?? (() => ({ ok: true, root: dir })), ...(ops ? { ops } : {}) }));
  const svc = createLinePlanService({ root: dir, commands: null, afterSave: (_r, f) => saved.push(f), load: (o) => loadPlanApi({ ...o, linkOptions: NO_LINK }) });
  app.use('/api/line', createLinePlanRouter({ clientOrigin: ORIGIN, getRoot: () => ({ ok: true, root: dir }), serviceFor: () => svc }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const line = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const base = `${line}/import`;
  const { approvalToken } = await (await fetch(`${line}/plan`)).json();
  const send = (url, body, headers) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-line-approval': approvalToken, ...headers }, body: JSON.stringify(body) });
  const post = (p, body, headers = {}) => send(`${base}${p}`, body, headers);
  const plan = async (p, body) => (await send(`${line}/plan${p}`, body, {})).json();
  return { dir, base, line, post, plan, saved };
}

test('folders, scan, plan over HTTP, then the steps through the plan: the answer reaches the plan, the import lands, App.tsx is untouched', async (t) => {
  const { dir, base, line, post, plan: planApi, saved } = await serve(t);
  const folders = await (await fetch(`${base}/folders`)).json();
  assert.ok(folders.folders.some((f) => f.path === 'src/alerts'));
  const scan = await (await post('/scan', { folder: 'src/alerts' })).json();
  assertImportScan(scan);
  assert.equal(scan.questions[0].id, TABLE_Q);
  const plan = await (await post('/plan', { folder: 'src/alerts', answers: { [TABLE_Q]: 'feature:alerts' } })).json();
  assertImportPlan(plan);
  assert.ok(plan.steps.some((s) => s.args.name === 'Table' && s.tool === 'line.import.toFeature'));
  const app = fs.readFileSync(path.join(dir, 'src/App.tsx'));
  assert.equal((await post('/apply', { folder: 'src/alerts', answers: {} })).status, 404, 'the direct apply route is gone');
  const ids = [];
  for (const s of plan.steps) {
    const added = await planApi('/step', { tool: s.tool, args: s.args, why: s.sentence });
    assert.equal(added.ok, true, added.sentence);
    ids.push(added.stepId);
  }
  assert.equal(fs.existsSync(path.join(dir, 'src/alerts/architecture.yml')), false, 'nothing lands before the approval');
  const approved = await planApi('/approve', { stepIds: ids });
  assert.ok(approved.steps.every((s) => s.state === 'ready'), 'one approval for every import step');
  for (const id of ids) {
    const ran = await planApi('/run', { stepId: id });
    assert.equal(ran.steps.find((s) => s.id === id).state, 'done');
  }
  assert.ok((await (await fetch(`${line}/plan`)).json()).steps.every((s) => s.state === 'done'));
  assert.ok(fs.existsSync(path.join(dir, 'src/alerts/features/alerts/components/Table.tsx')));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'src/App.tsx')), app);
  assert.ok(saved.length > 0 && saved.every((f) => f.startsWith('src/alerts/')));
});

test('refusals: a folder outside the project, a foreign page, no project; each one sentence and nothing written', async (t) => {
  const { dir, post } = await serve(t);
  const before = fs.readdirSync(path.join(dir, 'src'));
  const bad = await post('/plan', { folder: '../..' });
  assert.equal(bad.status, 400);
  const b = await bad.json();
  assert.equal(b.code, 'BAD_FOLDER');
  assert.match(b.sentence, /^".*" is not a folder inside the project; .*\.$/);
  const foreign = await post('/scan', { folder: 'src/alerts' }, { origin: 'http://evil.example' });
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
  const { post } = await serve(t, { ops: { folders: () => mock.folders(), scan: (_r, b) => mock.scan(b), plan: (_r, b) => mock.plan(b) } });
  assertImportScan(await (await post('/scan', { folder: 'src/alerts' })).json());
  assert.equal((await post('/scan', { folder: 'nope' })).status, 400);
});
