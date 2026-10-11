// ci2 -- /api/line/import-agent routes (lineImportAgentApi.mjs) on a copy of examples/import-sample: the real agent behind
// HTTP, sharing ONE plan service with /api/line/plan (the person approves the agent's plan steps there), refusals as one
// sentence, and the routes on the contract's mock too (what mock mode uses).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLineImportAgentRouter } from './lineImportAgentApi.mjs';
import { createLinePlanRouter } from './linePlanApi.mjs';
import { createLinePlanService } from '../../../packages/engine/line/planService.mjs';
import { createMockImportAgentService } from '../../../packages/engine/line/mockImportAgent.mjs';
import { assertImportAgentView, assertPlanView } from '../../../packages/engine/line/contract.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/import-sample');
const ORIGIN = 'http://localhost:3000';
const FOLDER = 'src/alerts';

async function serve(t, { agentFor, getRoot } = {}) {
  const dir = makeTempDir('construct-line-import-agent-api-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  const services = new Map();
  const planServiceFor = (root) => { if (!services.has(root)) services.set(root, createLinePlanService({ root, commands: null })); return services.get(root); };
  const app = express();
  app.use(express.json());
  const root = getRoot ?? (() => ({ ok: true, root: dir }));
  app.use('/api/line', createLinePlanRouter({ clientOrigin: ORIGIN, getRoot: root, serviceFor: planServiceFor }));
  app.use('/api/line', createLineImportAgentRouter({ clientOrigin: ORIGIN, getRoot: root, planServiceFor, ...(agentFor ? { agentFor } : {}) }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const post = async (p, body, headers = {}) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
  return { dir, post, get };
}

test('start, skip one step, approve all in the review: the person\'s approval carries to the plan steps, which run (shown in /plan) until verify ends it', async (t) => {
  const { dir, post, get } = await serve(t);
  const idle = await get(`/import-agent?folder=${encodeURIComponent(FOLDER)}`);
  assert.equal(idle.status, 200);
  assertImportAgentView(idle.body);
  assert.equal(idle.body.state, 'idle');
  let v = (await post('/import-agent/start', { folder: FOLDER })).body;
  assertImportAgentView(v);
  assert.equal(v.state, 'review');
  const skipped = (await post('/import-agent/step', { folder: FOLDER, action: 'skip', stepId: 'import-5-lib-Table' })).body;
  assert.equal(skipped.steps.find((s) => s.id === 'import-5-lib-Table').review, 'skipped');
  v = (await post('/import-agent/step', { folder: FOLDER, action: 'approve-all' })).body;
  assertImportAgentView(v);
  // The person approved the review in Cockpit, so the steps they approved run; the plan panel shows them done.
  assert.equal(v.state, 'done', v.sentence);
  assert.equal(v.steps.find((s) => s.id === 'import-5-lib-Table').run, 'todo', 'a skipped step never runs');
  const plan = (await get('/plan')).body;
  assertPlanView(plan);
  assert.equal(plan.steps.length, 9);
  assert.ok(plan.steps.every((s) => s.state === 'done' && s.tool.startsWith('line.import.')));
  assert.ok(fs.existsSync(path.join(dir, FOLDER, 'line/import-plan.json')));
  assert.ok(fs.existsSync(path.join(dir, FOLDER, 'features/alerts/pages/AlertsPage.tsx')));
});

test('refusals: a folder outside the project, a missing folder, no project, a foreign page, an unknown action; each one sentence', async (t) => {
  const { post, get } = await serve(t);
  const outside = await post('/import-agent/start', { folder: '../etc' });
  assert.deepEqual([outside.status, outside.body.code], [400, 'BAD_FOLDER']);
  assert.match(outside.body.sentence, /^The import folder must be a folder inside the project/);
  const missing = await get('/import-agent?folder=src/nope');
  assert.deepEqual([missing.status, missing.body.sentence], [400, 'The project has no folder src/nope.']);
  const foreign = await post('/import-agent/start', { folder: FOLDER }, { origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  const notStarted = await post('/import-agent/resume', { folder: FOLDER });
  assert.deepEqual([notStarted.status, notStarted.body.code], [400, 'NOT_STARTED']);
  await post('/import-agent/start', { folder: FOLDER });
  const bad = await post('/import-agent/step', { folder: FOLDER, action: 'explode', stepId: 'import-1-mark' });
  assert.deepEqual([bad.status, bad.body.code], [400, 'BAD_ACTION']);
  const noq = await post('/import-agent/answer', { folder: FOLDER, questionId: 'x', optionId: 'y' });
  assert.deepEqual([noq.status, noq.body.code], [400, 'NO_QUESTION']);
  const { get: get2 } = await serve(t, { getRoot: () => ({ ok: false, error: 'No project is open; pick a project first.' }) });
  const none = await get2(`/import-agent?folder=${FOLDER}`);
  assert.deepEqual([none.status, none.body.sentence], [400, 'No project is open; pick a project first.']);
});

test('the routes run on the contract mock too: the planted refusal gets a fix that waits for the person', async (t) => {
  const mock = createMockImportAgentService();
  const { post } = await serve(t, { agentFor: (_root, folder) => mock.agentFor(folder) });
  await post('/import-agent/start', { folder: FOLDER });
  const v = (await post('/import-agent/step', { folder: FOLDER, action: 'approve-all' })).body;
  assertImportAgentView(v);
  assert.equal(v.waiting.for, 'approval');
  assert.equal(mock.planService.steps.find((s) => s.id === v.waiting.planStepId).tool, 'line.import.fix');
});
