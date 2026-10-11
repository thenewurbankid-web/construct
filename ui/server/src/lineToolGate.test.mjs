// cu3 -- the Cockpit side of the one tool registry: every /api/line route maps to exactly one registry entry, and the
// tool gate (lineToolGate.mjs) turns a project write into a waiting plan step, logs a Line-state write, and refuses a
// route the registry does not know.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { LINE_API, assertToolList } from '../../../packages/engine/line/contract.mjs';
import { TOOL_ENTRIES, entriesForRoute, toolLogFile } from '../../../packages/engine/line/toolRegistry.mjs';
import { createLinePlanService, loadPlanApi } from '../../../packages/engine/line/planService.mjs';
import { createLineRouter } from './lineApi.mjs';
import { createLineOpsRouter } from './lineOpsApi.mjs';
import { createLinePlanRouter } from './linePlanApi.mjs';
import { createLineRenderRouter } from './lineRenderApi.mjs';
import { createLineToolGate } from './lineToolGate.mjs';
import { createLineImportRouter } from './lineImportApi.mjs';
import { createLineAiRouter } from './lineAiApi.mjs';
import { createLineTraceRouter } from './lineTraceApi.mjs';
import { createLineImportAgentRouter } from './lineImportAgentApi.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/line-sample');
const NO_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
const ORIGIN = 'http://localhost:3000';
const BADGE = 'features/orders/components/StatusBadge.tsx';

/** Every route an express router declares, as "METHOD /api/line/path". */
function routesOf(router) {
  return router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} /api/line${l.route.path}`));
}
const noRoot = () => ({ ok: false, error: 'No project.' });
const ALL_ROUTERS = () => [createLineRouter({ getRoot: noRoot }), createLineOpsRouter({ getRoot: noRoot }), createLinePlanRouter({ getRoot: noRoot }), createLineRenderRouter({ getRoot: noRoot }), createLineImportRouter({ getRoot: noRoot }), createLineAiRouter(), createLineTraceRouter({ getRoot: noRoot }), createLineImportAgentRouter({ getRoot: noRoot }), createLineToolGate({ getRoot: noRoot })];
/** cu7's new-project router is mounted at its own path, /api/line/new-project, before the gate (it needs no open project). */
const MOUNTED_APART = ['POST /api/line/new-project'];
function sampleCopy() {
  const dir = makeTempDir('construct-line-gate-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}
const builtInPlan = (root) => createLinePlanService({ root, commands: null, load: (o) => loadPlanApi({ ...o, linkOptions: NO_LINK }) });

test('Cockpit: every /api/line route maps to exactly one registry entry, and every route in the registry exists', () => {
  const declared = [...new Set([...ALL_ROUTERS().flatMap(routesOf), ...MOUNTED_APART])].sort();
  assert.deepEqual(declared, LINE_API.map((r) => `${r.method} ${r.path}`).sort(), 'the routers serve exactly LINE_API');
  for (const route of declared) {
    const [method, p] = route.split(' ');
    assert.equal(entriesForRoute(method, p).length, 1, `${route} maps to exactly one entry`);
  }
  const inRegistry = TOOL_ENTRIES.filter((e) => e.surfaces.http).map((e) => `${e.surfaces.http.method} ${e.surfaces.http.path}`).sort();
  assert.deepEqual(inRegistry, declared);
});

test('Cockpit gate (real sample, built-in plan store): POST /base-on is gone, a plan step waits and writes nothing; the workspace write is logged; an unknown route is a 404 sentence; /tools lists the registry', async (t) => {
  const root = sampleCopy();
  const svc = builtInPlan(root);
  const app = express();
  app.use(express.json());
  const getRoot = () => ({ ok: true, root });
  app.use('/api/line', createLineToolGate({ getRoot, clientOrigin: ORIGIN, planServiceFor: () => svc }));
  app.use('/api/line', createLineOpsRouter({ getRoot, clientOrigin: ORIGIN }));
  app.use('/api/line', createLinePlanRouter({ getRoot, clientOrigin: ORIGIN, serviceFor: () => svc }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/line`;
  const post = async (p, body) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

  // The direct write routes are gone (integrator): a project change is only ever a plan step, added through /plan/step.
  assert.equal((await post('/base-on', { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' })).status, 404);
  const planned = await post('/plan/step', { tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' } });
  assert.equal(planned.status, 200);
  assert.equal(fs.existsSync(path.join(root, BADGE)), false, 'nothing written before Approve');
  const plan = await (await fetch(`${base}/plan`)).json();
  assert.deepEqual(plan.steps.map((s) => [s.tool, s.state]), [['line.baseOn', 'waiting']]);
  assert.equal(plan.steps[0].id, planned.body.stepId);
  assert.match(fs.readFileSync(toolLogFile(root), 'utf8'), /"tool":"plan.addStep"/);

  const ws = await post('/workspace', { folder: 'features/orders' });
  assert.equal(ws.status, 200);
  assert.match(fs.readFileSync(toolLogFile(root), 'utf8'), /"tool":"line.setWorkspace"/);

  const unknown = await fetch(`${base}/delete-everything`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).sentence, 'Line has no tool at POST /api/line/delete-everything.');
  const tools = await (await fetch(`${base}/tools`)).json();
  assertToolList(tools);
  assert.ok(tools.tools.find((x) => x.id === 'line.baseOn' && x.kind === 'write' && x.writes === 'project' && x.controlId === 'components.baseOn'));
});
