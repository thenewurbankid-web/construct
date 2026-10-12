import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_ENTRIES } from '../../../packages/engine/line/toolRegistry.mjs';
import { LINE_CONTROLS } from '../../../packages/engine/line/controls.mjs';
import { stageBlocks, stepsFromRows, toolOfCall } from './liveStage.ts';
import { presentationOf, presentationProblems } from './toolPresentations.ts';
import doc from './toolPresentations.json' with { type: 'json' };
import { matchElement } from './elementMatch.ts';
import { toolForPoint } from './controlTool.ts';

const place = (...ids) => ({ screen: 'features', steps: ids.map((id, i) => ({ param: ['feature', 'item', 'part'][i], id, label: id })) });
const row = (n, state, call, extra = {}) => ({ id: `s${n}`, n, state, stateLabel: state === 'waiting' ? 'Waiting for your approval' : state, sentence: `Step ${n} does a thing.`, fixes: [], call, ...extra });

test('tool presentations: every registry tool has a valid, decided spec (generated offline, rules then jev)', () => {
  assert.deepEqual(presentationProblems(doc, TOOL_ENTRIES.map((e) => e.id)), []);
  assert.equal(presentationOf('line.setPageProp').kind.value, 'page');
  assert.equal(presentationOf('line.fix').overlay.value, 'badge');
  assert.ok(Object.values(doc.tools).every((t) => Object.values(t).every((f) => f.by === 'rules' || f.by === 'jev')));
  assert.deepEqual(presentationProblems({ tools: { x: {} } }, ['line.fix']), ['Tool "line.fix" has no presentation; run node packages/tools/tool-presentations/generate.mjs.', 'Presentation "x" is for a tool the registry does not have.']);
});

test('live stage: the active parts are the breadcrumb\'s levels, the last in focus', () => {
  assert.deepEqual(stageBlocks(place(), [], []), []);
  const parts = [
    { param: 'feature', id: 'orders', status: 'fit' },
    { param: 'item', id: 'OrdersPage', kind: 'page', status: 'fit', base: 'ListPage' },
  ];
  const b = stageBlocks(place('orders', 'OrdersPage'), parts, []);
  assert.deepEqual(b.map((x) => [x.id, x.kind, x.icon, x.focus, x.base]), [['feature:orders', 'feature', 'folder', false, null], ['item:OrdersPage', 'page', 'page', true, 'ListPage']]);
  const part = stageBlocks(place('orders', 'OrdersPage', 'title'), parts, []);
  assert.deepEqual(part.map((x) => [x.id, x.focus, x.statusLabel]), [['feature:orders', false, 'All fine'], ['item:OrdersPage', false, 'All fine'], ['part:title', true, 'Open']]);
});

test('live stage: waiting, running and refused steps join the stage; the last done one stays as the "after"; older done ones leave', () => {
  const steps = stepsFromRows([
    row(1, 'done', 'line.baseOn({"name":"A"})'),
    row(2, 'done', 'line.setPageProp({"prop":"title"})'),
    row(3, 'waiting', 'line.setPageProp({"prop":"title"})'),
    row(4, 'needs-fix', 'line.promote({})', { fixes: ['Point InvoicesPage at the library copy.'] }),
    row(5, 'skipped', 'line.fix({})'),
  ]);
  const b = stageBlocks(place('orders'), [], steps);
  assert.deepEqual(b.map((x) => [x.id, x.status, x.statusLabel]), [['feature:orders', 'open', 'Open'], ['step:s3', 'wait', 'Waiting for your approval'], ['step:s4', 'problem', 'needs-fix'], ['step:s2', 'fit', 'done']]);
  assert.equal(b[2].fix, 'Point InvoicesPage at the library copy.');
  assert.deepEqual(b[1].states, presentationOf('line.setPageProp').states.value);
  assert.equal(toolOfCall('plan.approve({"stepId":"s1"})'), 'plan.approve');
  assert.equal(toolOfCall('nothing'), '');
});

test('element match: the static ladder, first unique rung wins; none unique is no outline and one sentence', () => {
  const els = [
    { key: 'a', lineTarget: 'OrdersPage', role: 'listitem', name: 'OrdersPage', position: '0.0' },
    { key: 'b', nodeId: 'n7', role: 'button', name: 'More', label: 'More', position: '0.1' },
    { key: 'c', role: 'button', name: 'More', label: 'More', position: '0.2' },
    { key: 'd', role: 'heading', name: 'Orders', label: 'Orders', position: '1.0' },
  ];
  assert.deepEqual(matchElement({ lineTarget: 'orderspage', what: 'OrdersPage' }, els), { ok: true, key: 'a', by: 'line-id' });
  assert.deepEqual(matchElement({ nodeId: 'n7', role: 'button', name: 'More', what: 'More' }, els), { ok: true, key: 'b', by: 'node-id' });
  assert.deepEqual(matchElement({ role: 'heading', name: 'Orders', what: 'the title' }, els), { ok: true, key: 'd', by: 'role-name' });
  assert.deepEqual(matchElement({ role: 'button', name: 'More', position: '0.2', what: 'More' }, els), { ok: true, key: 'c', by: 'position' });
  assert.deepEqual(matchElement({ role: 'button', name: 'More', what: 'the More button' }, els), { ok: false, sentence: 'Several things on screen could be the More button, so none is outlined.' });
  assert.deepEqual(matchElement({ lineTarget: 'Nope', what: 'Nope' }, els), { ok: false, sentence: 'Nope is not on screen, so nothing is outlined.' });
});

test('tool for a point: the control registry first, then a unique registered label; several tools is no guess', () => {
  assert.deepEqual(toolForPoint({ lineControl: 'pages.propSave' }, LINE_CONTROLS), { ok: true, toolId: 'line.setPageProp', controlId: 'pages.propSave', by: 'control' });
  assert.deepEqual(toolForPoint({ label: 'Promote to library', screen: 'components' }, LINE_CONTROLS), { ok: true, toolId: 'line.promote', controlId: 'components.promote', by: 'label' });
  const save = toolForPoint({ label: 'Save' }, [...LINE_CONTROLS, { controlId: 'components.save', toolId: 'line.baseOn', screen: 'components', label: 'Save' }]);
  assert.equal(save.ok, false);
  assert.deepEqual(save.candidates.sort(), ['line.baseOn', 'line.setPageProp']);
  assert.equal(toolForPoint({ label: 'Nothing here' }, LINE_CONTROLS).sentence, '"Nothing here" is not a Line control, so it maps to no tool.');
});
