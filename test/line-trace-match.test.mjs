// cg1 + ct1 -- Trace: the one control registry, the static request -> tool -> control mapping over common requests,
// jev's pick when several tools fit (and the static fallback when jev or @mx/reason is down), the plan's open steps
// lighting their controls, and Auto's scripts (which stop at Approve).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertControlRegistry, assertTraceMatch, assertLineControl, LINE_API, LINE_PLAN_TOOLS, PLAN_ACTION_TOOLS } from '../packages/engine/line/contract.mjs';
import { LINE_CONTROLS, TOOL_PATHS, controlById } from '../packages/engine/line/controls.mjs';
import { matchRequest, traceMatch } from '../packages/engine/line/traceMatch.mjs';
import { TOOL_ENTRIES, entryById } from '../packages/engine/line/toolRegistry.mjs';
import { createTraceDecide, createJevPicker, clozeOf } from '../packages/engine/line/traceDecide.mjs';
import { readLineProject } from '../packages/engine/line/model.mjs';
import { createMockLineOps } from '../packages/engine/line/mock.mjs';
import { createMockReason, createMockPicker } from '../packages/line-links/mocks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = readLineProject(path.join(ROOT, 'examples/line-sample'));
const lit = (m) => m.tools[0].controls.map((c) => `${c.controlId}${c.target ? `:${c.target}` : ''}`);

test('contract: one control registry, every control names a known tool and screen, ids are unique', () => {
  assertControlRegistry(LINE_CONTROLS);
  assert.throws(() => assertControlRegistry([...LINE_CONTROLS, LINE_CONTROLS[0]]), /unique/);
  assert.throws(() => assertLineControl({ controlId: 'pages.save', toolId: 'line.nope', screen: 'pages', label: 'Save' }), /plan tool/);
  assert.throws(() => assertLineControl({ controlId: 'pages.save', toolId: 'line.setPageProp', screen: 'components', label: 'Save' }), /start with its screen/);
  assert.throws(() => assertLineControl({ controlId: 'pages.save', toolId: 'line.setPageProp', screen: 'pages', label: 'Save it.' }), /label/);
  assert.ok(LINE_API.some((r) => r.method === 'POST' && r.path === '/api/line/trace'));
});

test('contract: the mock tool list is cp1\'s plan tools plus the plan actions, each with the control that triggers it', () => {
  // One tool catalog (toolRegistry.mjs): every plan tool and plan action is in it, and its controlId is a control of it.
  for (const t of [...LINE_PLAN_TOOLS, ...PLAN_ACTION_TOOLS]) assert.ok(entryById(t.name), `${t.name} is in the tool catalog`);
  for (const e of TOOL_ENTRIES) if (e.controlId && controlById(e.controlId)) assert.equal(controlById(e.controlId).toolId, e.id, `${e.id}.controlId`);
  assert.equal(entryById('line.baseOn').controlId, 'components.baseOn');
  // Every control a path names is registered; every registered control is on some path.
  const onPaths = new Set(Object.values(TOOL_PATHS).flat());
  for (const id of onPaths) assert.ok(controlById(id), id);
  for (const c of LINE_CONTROLS) assert.ok(onPaths.has(c.controlId), `${c.controlId} is on no path`);
});

const COMMON = [
  ['Base a new StatusBadge on Badge in orders', 'line.baseOn', ['components.baseOn:Badge', 'components.baseOnFeature:Badge', 'components.baseOnName:Badge', 'components.baseOnCreate:Badge', 'plan.approve']],
  ['Create a component from the Button', 'line.baseOn', ['components.baseOn:Button', 'components.baseOnFeature:Button', 'components.baseOnName:Button', 'components.baseOnCreate:Button', 'plan.approve']],
  ['Promote OrderButton to the library', 'line.promote', ['components.promote:OrderButton', 'components.promoteConfirm:OrderButton', 'plan.approve']],
  ['Change the title of OrdersPage to My orders', 'line.setPageProp', ['pages.feature:orders', 'pages.page:OrdersPage', 'pages.propInput:title', 'pages.propSave:title', 'plan.approve']],
  ['Set the label prop on the orders page', 'line.setPageProp', ['pages.feature:orders', 'pages.page:OrdersPage', 'pages.propInput:label', 'pages.propSave:label', 'plan.approve']],
  ['Edit the code of what happens when More is clicked on OrdersPage', 'line.setFragment', ['pages.feature:orders', 'pages.page:OrdersPage', 'pages.codeToggle:OrdersPage', 'pages.fragmentSave:OrdersPage', 'plan.approve']],
  ['Fix the problem in billing', 'line.fix', ['features.finding', 'plan.fix', 'plan.approve']],
  ['Approve the waiting step', 'plan.approve', ['plan.approve']],
  ['Show me the features', 'line.project', ['features.card']],
  ['Leave it as it is', 'line.leaveAsIs', ['plan.leave']],
  ['Try that step again', 'plan.retry', ['plan.retry']],
];

for (const [request, tool, controls] of COMMON) {
  test(`static: "${request}" lights ${tool}'s controls`, async () => {
    const m = await traceMatch({ request }, { project: SAMPLE });
    assertTraceMatch(m);
    assert.equal(m.via, 'static');
    assert.equal(m.choice, null);
    assert.equal(m.tools[0].toolId, tool);
    assert.deepEqual(lit(m), controls);
  });
}

test('static: the request\'s names fill Auto\'s script; it ends at Approve and the change is not made here', async () => {
  const m = await traceMatch({ request: 'Base a new StatusBadge on Badge in orders' }, { project: SAMPLE });
  assert.deepEqual(m.tools[0].args, { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' });
  assert.deepEqual(m.tools[0].script.map((a) => [a.kind, a.controlId, a.value ?? null]), [
    ['click', 'components.baseOn', null], ['select', 'components.baseOnFeature', 'orders'], ['type', 'components.baseOnName', 'StatusBadge'], ['click', 'components.baseOnCreate', null], ['approve', 'plan.approve', null],
  ]);
  assert.equal(m.tools[0].missing, null);
  assert.equal(m.sentence, 'Base a new StatusBadge on Badge in orders. The lit controls do it.');
  const page = await traceMatch({ request: 'Change the title of OrdersPage to My orders' }, { project: SAMPLE });
  assert.deepEqual(page.tools[0].script.find((a) => a.kind === 'type'), { kind: 'type', controlId: 'pages.propInput', target: 'title', value: 'My orders', caption: 'Type My orders as the new title.' });
});

test('static: what Auto still needs is one sentence, and no script runs without it', async () => {
  const m = await traceMatch({ request: 'Base something on Badge' }, { project: SAMPLE });
  assert.equal(m.tools[0].toolId, 'line.baseOn');
  assert.deepEqual(m.tools[0].script, []);
  assert.equal(m.tools[0].missing, 'Say which feature the new component goes in, for example "in orders".');
  const none = await traceMatch({ request: 'Make me a sandwich' });
  assert.deepEqual(none.tools, []);
  assert.match(none.sentence, /^Trace found no control for that/);
  const empty = await traceMatch({});
  assert.equal(empty.sentence, 'Type what you want to do, and Trace lights up the controls that do it.');
});

test('steps: a waiting step lights its Approve, a step that needs you its choices, a done step nothing', async () => {
  const m = await traceMatch({ steps: [{ id: 's1', n: 1, tool: 'line.baseOn', state: 'done' }, { id: 's2', n: 2, tool: 'line.promote', state: 'waiting' }, { id: 's3', n: 3, tool: 'line.baseOn', state: 'needs-fix' }, { id: 's4', n: 4, tool: 'line.baseOn', state: 'needs-you' }] });
  assertTraceMatch(m);
  assert.deepEqual(m.tools.map((t) => [t.toolId, t.stepId, t.controls.map((c) => `${c.controlId}:${c.target}`)]), [
    ['plan.approve', 's2', ['plan.approve:2']],
    ['line.fix', 's3', ['features.finding:null', 'plan.fix:3', 'plan.approve:3']],
    ['plan.retry', 's4', ['plan.retry:4']],
  ]);
  assert.equal(m.tools[0].sentence, 'Step 2 waits for your approval.');
  assert.deepEqual(m.tools[0].script.map((a) => a.kind), ['approve']);
});

test('several fit: static order without jev, and the reason says why', async () => {
  assert.deepEqual(matchRequest('Move OrderButton into the library').map((m) => m.toolId), ['line.promote', 'line.moveFile']);
  const m = await traceMatch({ request: 'Move OrderButton into the library' }, { project: SAMPLE });
  assertTraceMatch(m);
  assert.equal(m.via, 'static');
  assert.deepEqual(m.choice.options, ['line.promote', 'line.moveFile']);
  assert.equal(m.tools[0].toolId, 'line.promote');
  assert.deepEqual(m.alternatives, ['line.moveFile']);
});

test('several fit: jev picks with a cloze through @mx/reason, and via records jev', async () => {
  const picker = createMockPicker(1);
  const decide = createTraceDecide({ picker, loadReason: async () => createMockReason() });
  const m = await traceMatch({ request: 'Move OrderButton into the library' }, { project: SAMPLE, decide });
  assertTraceMatch(m);
  assert.equal(m.via, 'jev');
  assert.equal(m.choice.picked, 'line.moveFile');
  assert.equal(m.choice.sentence, 'Several tools fit; jev picked "move a file".');
  assert.deepEqual(picker.calls, [['line.promote', 'line.moveFile']]);
  assert.equal(clozeOf('Move it'), 'The person asked: "Move it". To do that in Cockpit, they use the tool to ___.');
});

test('fallback: jev not reachable, @mx/reason not linked or failing all keep the static pick and say so', async () => {
  const req = { request: 'Make OrderButton reusable' };
  const down = await traceMatch(req, { project: SAMPLE, decide: createTraceDecide({ picker: createMockPicker(1, { available: false }), loadReason: async () => createMockReason() }) });
  assert.equal(down.via, 'static');
  assert.equal(down.choice.picked, 'line.baseOn');
  assert.match(down.choice.sentence, /static order \(jev is not reachable\)\.$/);
  const unlinked = await traceMatch(req, { decide: createTraceDecide({ picker: createMockPicker(1), loadReason: async () => null }) });
  assert.equal(unlinked.via, 'static');
  assert.match(unlinked.choice.sentence, /reason module is not available/);
  const broken = await traceMatch(req, { decide: createTraceDecide({ picker: createMockPicker(1), loadReason: async () => createMockReason({ fail: true }) }) });
  assert.equal(broken.via, 'static');
  const throws = await traceMatch(req, { decide: async () => { throw new Error('boom'); } });
  assert.equal(throws.via, 'static');
  // The real jev client: nothing listening answers "not available" quickly.
  const real = createJevPicker({ url: 'http://127.0.0.1:9' });
  assert.equal(await real.available(), false);
});

test('mock project: the client\'s mock mode maps the same way', async () => {
  const mock = createMockLineOps().readLineProject('/mock');
  const m = await traceMatch({ request: 'Promote OrderButton to the library' }, { project: mock });
  assert.deepEqual(m.tools[0].args, { featureItemId: 'orders/components/OrderButton' });
});

test('the Cockpit carries every registered control: data-line-control on the real buttons, menus and panels', () => {
  const dir = path.join(ROOT, 'ui/client/features');
  const src = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.tsx$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  for (const c of LINE_CONTROLS) assert.ok(src.includes(`data-line-control="${c.controlId}"`) || src.includes(`'${c.controlId}'`), `${c.controlId} is not on any control`);
  const used = [...src.matchAll(/data-line-control="([^"]+)"/g)].map((m) => m[1]);
  for (const id of used) assert.ok(controlById(id), `${id} is on a control but not in the registry`);
});
