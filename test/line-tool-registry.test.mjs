// cu3 -- ONE tool registry (packages/engine/line/toolRegistry.mjs): every /api/line route, every construct-mcp tool,
// every plan tool, GateLM's tools and Studio's dispatcher resolve to exactly one registry entry, and no write to
// project files is callable without a person's approval (it only ever becomes a plan step).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertToolEntry, assertToolList } from '../packages/engine/line/contract.mjs';
import {
  TOOL_ENTRIES, allEntries, commandEntries, createToolRegistry, entriesForMcp, lineHandlers, realLineOps, studioHandlers, toolLogFile,
} from '../packages/engine/line/toolRegistry.mjs';
import { createMockToolRegistry } from '../packages/engine/line/toolRegistryMock.mjs';
import { createLinePlanService, loadPlanApi } from '../packages/engine/line/planService.mjs';
import { createLinePlanRegistry, constructCommandTools } from '../packages/engine/line/planTools.mjs';
import { importLinked } from '../packages/line-links/index.mjs';
import { TOOLS, PLAN_TOOLS, IMPORT_AGENT_TOOLS } from '../packages/mcp/src/server.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const NO_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };

function sampleCopy() {
  const dir = makeTempDir('construct-line-tools-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}
const builtInPlan = (root) => createLinePlanService({ root, commands: null, load: (o) => loadPlanApi({ ...o, linkOptions: NO_LINK }) });

test('contract: every registry entry is typed (id, read|write, what it writes, input and output schema, one sentence); ids are unique', () => {
  for (const e of TOOL_ENTRIES) assertToolEntry(e);
  const { registry } = createMockToolRegistry();
  assertToolList(registry.list());
  assert.equal(new Set(TOOL_ENTRIES.map((e) => e.id)).size, TOOL_ENTRIES.length);
  assert.throws(() => assertToolEntry({ ...TOOL_ENTRIES[0], kind: 'write', writes: null }), /project or line/);
  assert.throws(() => assertToolEntry({ id: 'line.x', kind: 'write', writes: 'project', inputSchema: TOOL_ENTRIES[0].inputSchema, outputSchema: 'X', sentence: 'Writes.', surfaces: { mcp: 'x' } }), /plan step/);
  assert.throws(() => assertToolEntry({ id: 'line.x', kind: 'write', writes: 'line', inputSchema: TOOL_ENTRIES[0].inputSchema, outputSchema: 'X', sentence: 'Writes.', surfaces: { http: { method: 'GET', path: '/api/line/x' } } }), /only reads/);
  // controlId is optional; where set it names a Cockpit control (cg1/ct1 light it up).
  assert.ok(TOOL_ENTRIES.some((e) => e.controlId) && TOOL_ENTRIES.some((e) => !e.controlId));
});

test('MCP: every construct-mcp tool maps to exactly one registry entry; read-only exactly when the entry reads; none writes project files; none approves', () => {
  for (const t of [...TOOLS, ...PLAN_TOOLS, ...IMPORT_AGENT_TOOLS]) {
    const m = entriesForMcp(t.name);
    assert.equal(m.length, 1, `${t.name} maps to exactly one entry`);
    const readOnly = /** @type {any} */ (t).annotations?.readOnlyHint ?? true;
    assert.equal(readOnly, m[0].kind === 'read', `${t.name}: readOnlyHint agrees with the registry`);
    assert.notEqual(m[0].writes, 'project', `${t.name} never writes project files`);
    assert.ok(!m[0].personOnly);
  }
  const mcpEntries = TOOL_ENTRIES.filter((e) => e.surfaces.mcp).map((e) => e.surfaces.mcp).sort();
  assert.deepEqual(mcpEntries, [...TOOLS, ...PLAN_TOOLS, ...IMPORT_AGENT_TOOLS].map((t) => t.name).sort());
});

test('plan: every tool the plan runner can call (line.* and construct.*) is one registry entry of the same kind', async () => {
  const commands = await constructCommandTools();
  const entries = allEntries(commandEntries(commands));
  const runner = createLinePlanRegistry({ root: SAMPLE, commands });
  for (const t of runner.list()) {
    const m = entries.filter((e) => e.id === t.name);
    assert.equal(m.length, 1, `${t.name} maps to exactly one entry`);
    assert.equal(m[0].kind, t.kind, `${t.name} kind`);
    if (t.kind === 'write' && t.name.startsWith('construct.')) assert.equal(m[0].writes, 'project');
  }
  assert.ok(entries.some((e) => e.id === 'construct.validate' && e.kind === 'read'));
});

const fakeGatelmApi = (calls) => new Proxy({}, { get: (_t, name) => async (...a) => { calls.push([name, a]); return { ok: true, draftId: 'd1' }; } });

test('GateLM: @mx/plan\'s gatelmTools are exactly the registry\'s gatelm.* entries, kind for kind (linked), and run through dispatch', async (t) => {
  const linked = await importLinked('@mx/plan');
  if (!linked.ok) { t.skip(`@mx/plan is not linked: ${linked.reason}`); return; }
  const calls = [];
  const tools = linked.module.gatelmTools(fakeGatelmApi(calls), 'person');
  const catalog = TOOL_ENTRIES.filter((e) => e.surfaces.gatelm);
  assert.deepEqual(tools.map((x) => `${x.name}:${x.kind}`).sort(), catalog.map((e) => `${e.id}:${e.kind}`).sort());
  const root = makeTempDir('construct-line-gatelm-');
  const registry = createToolRegistry({ root, planService: builtInPlan(root), gatelm: tools });
  const r = await registry.dispatch('gatelm.fill', { draftId: 'd1', gapKey: 'name', value: 'Badge' }, { by: 'person' });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'direct', 'a draft is Line\'s own state: written by GateLM\'s store without asking');
  assert.deepEqual(calls.map((c) => c[0]), ['fill']);
  assert.match(fs.readFileSync(toolLogFile(root), 'utf8'), /"tool":"gatelm.fill","by":"ui","ok":true/);
  // A GateLM tool that does not match the registry is refused when the registry is built.
  assert.throws(() => createToolRegistry({ root, planService: builtInPlan(root), gatelm: [{ name: 'gatelm.find', kind: 'write', run: async () => ({}) }] }), /does not match/);
});

test('GateLM down: with no GateLM tools bound, a gatelm call is refused in one sentence and nothing else breaks', async () => {
  const { registry } = createMockToolRegistry();
  const r = await registry.dispatch('gatelm.find', { query: 'dialog' });
  assert.equal(r.ok, false);
  assert.match(r.sentence, /^gatelm\.find is not available here; .*\.$/);
  assert.equal((await registry.dispatch('line.project')).ok, true);
});

test('Studio: its own dispatcher (studio/src/dispatch.ts, linked) runs registry handlers; a project write from a chip becomes a plan step', async (t) => {
  const linked = await importLinked('@mx/studio-dispatch');
  if (!linked.ok) { t.skip(`Studio's dispatcher is not linked: ${linked.reason}`); return; }
  const { registry, plan } = createMockToolRegistry();
  const dispatch = linked.module.createDispatcher(studioHandlers(registry));
  const before = plan.files();
  const r = await dispatch({ tool: 'line.baseOn', args: { libraryId: 'components/Button', feature: 'orders', name: 'BuyButton' } }, { channel: 'chip' });
  assert.equal(r.via, 'plan');
  assert.match(r.sentence, /^Waiting for your approval: Creates BuyButton in feature orders/);
  assert.deepEqual(plan.files(), before, 'nothing written before approval');
  assert.equal((await dispatch({ tool: 'line.project', args: {} }, { channel: 'words' })).via, 'direct');
  await assert.rejects(dispatch({ tool: 'plan.approve', args: { stepId: r.stepId } }, { channel: 'tool' }), /Only a person can do this/);
  await assert.rejects(dispatch({ tool: 'nope.tool', args: {} }, { channel: 'chip' }), /Studio cannot run nope.tool yet/);
});

test('no write without approval: every project write, by an agent or a person, only becomes a waiting plan step; only a person approves; then it lands', async () => {
  const { registry, plan } = createMockToolRegistry();
  const before = plan.files();
  const fresh = TOOL_ENTRIES.find((x) => x.id === 'line.newProject');
  assert.ok(fresh.personOnly && !fresh.surfaces.mcp && !fresh.surfaces.plan);
  for (const by of ['agent', 'person']) {
    const r = await registry.dispatch('line.baseOn', { libraryId: 'components/Button', feature: 'orders', name: by === 'agent' ? 'AgentButton' : 'PersonButton' }, { by });
    assert.equal(r.ok, true); assert.equal(r.via, 'plan');
    assert.match(r.sentence, /^Waiting for your approval: /);
  }
  assert.deepEqual(plan.files(), before);
  // line.newProject (cu7) is the one exception: it makes a NEW project folder, so there is no project plan to add a
  // step to yet; it is person-only and never an agent tool.
  for (const e of TOOL_ENTRIES.filter((x) => x.writes === 'project' && x.id !== 'line.newProject')) {
    assert.ok(e.surfaces.plan, `${e.id} can only run as a plan step`);
    assert.ok(!e.surfaces.mcp, `${e.id} is not an agent tool`);
  }
  const waiting = (await plan.view()).steps[0];
  const ran = await registry.dispatch('plan.runNext', { stepId: waiting.id }, { by: 'agent' });
  assert.equal(ran.ok, false);
  assert.match(ran.sentence, /waits for a person to approve it/);
  const denied = await registry.dispatch('plan.approve', { stepId: waiting.id }, { by: 'agent' });
  assert.equal(denied.code, 'PERSON_ONLY');
  assert.equal((await registry.dispatch('plan.approve', { stepId: waiting.id }, { by: 'person' })).ok, true);
  assert.equal((await registry.dispatch('plan.runNext', { stepId: waiting.id }, { by: 'agent' })).ok, true, 'an agent may run a step a person approved');
  assert.ok(plan.files()['features/orders/components/AgentButton.tsx']);
  const bad = await registry.dispatch('line.baseOn', { feature: 'orders' });
  assert.equal(bad.code, 'BAD_ARGS');
  assert.match(bad.sentence, /^The arguments do not fit line\.baseOn: libraryId is required\.$/);
});

test('Line\'s own state: setting the workspace (real ops) is written at once, logged, and adds no plan step', async () => {
  const root = sampleCopy();
  const planService = builtInPlan(root);
  const registry = createToolRegistry({ root, planService, handlers: lineHandlers(root, await realLineOps()) });
  const r = await registry.dispatch('line.setWorkspace', { folder: 'features/orders' }, { by: 'person' });
  assert.equal(r.ok, true); assert.equal(r.via, 'direct');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'line/workspace.json'), 'utf8')).folder, 'features/orders');
  assert.match(fs.readFileSync(toolLogFile(root), 'utf8'), /"tool":"line.setWorkspace","by":"ui","ok":true/);
  assert.deepEqual((await planService.view()).steps, []);
  const read = await registry.dispatch('line.project', {}, { by: 'agent' });
  assert.equal(read.via, 'direct');
  assert.equal(/** @type {any} */ (read).result.isLine, true);
});

