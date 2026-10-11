// cw1 -- Line workflows: state machines between pages, used like primitives. The same story runs on the contract's
// mock and on a copy of examples/line-sample with the real engine (workflows.mjs over Construct's xstate extractor and
// editor, written only by applyChange): base a feature workflow on a library one, choose a page for a role, add a
// When -> Do transition, remove it again, and promote the workflow to the library. Plus the refusals, the plan tools
// in the one registry, and the generated machine actually running in xstate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActor } from 'xstate';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertLineWorkflowList, assertStagedChange, assertApplyResult, assertLineStepResult, LineOpError, LINE_PLAN_TOOLS } from '../packages/engine/line/contract.mjs';
import { createMockLineOps } from '../packages/engine/line/mock.mjs';
import { WORKFLOW_OPS, readMachine } from '../packages/engine/line/workflows.mjs';
import { applyChange, planPromote } from '../packages/engine/line/ops.mjs';
import { createLinePlanRegistry } from '../packages/engine/line/planTools.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const FILE = 'features/orders/workflows/orderBrowse.ts';
const BASE = { libraryId: 'workflows/listDetail', feature: 'orders', name: 'orderBrowse' };
const copy = () => { const dir = makeTempDir('line-workflows-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const refused = (code) => (e) => e instanceof LineOpError && e.code === code && /[.?!]$/.test(e.sentence);

const REAL = { ...WORKFLOW_OPS, applyChange, planPromote };
const IMPLS = [
  ['mock', () => ({ ops: createMockLineOps(), root: '/mock' })],
  ['real', () => ({ ops: REAL, root: copy() })],
];

for (const [kind, make] of IMPLS) {
  test(`${kind}: the library offers complete workflows with roles; a feature starts with none`, () => {
    const { ops, root } = make();
    const l = ops.readLineWorkflows(root, 'orders');
    assertLineWorkflowList(l);
    assert.deepEqual(l.workflows, []);
    assert.deepEqual(l.pages, ['OrdersPage']);
    const ld = l.library.find((w) => w.id === 'workflows/listDetail');
    assert.deepEqual(ld.roles.map((r) => [r.id, r.page]), [['list', null], ['detail', null]]);
    assert.deepEqual(ld.transitions.map((t) => [t.when, t.do]), [['When the list page sends OPEN.', 'Go to the detail page.'], ['When the detail page sends BACK.', 'Go to the list page.']]);
    assert.equal(ld.summary[0], 'listDetail has 2 pages for a feature to fill (list and detail) and 2 transitions.');
    assert.ok(l.library.some((w) => w.id === 'workflows/wizard'));
    if (kind === 'real') {
      assert.deepEqual(l.library.map((w) => w.name).sort(), ['createConfirm', 'listDetail', 'signInGate', 'wizard']);
      assert.deepEqual(l.notMachines.map((n) => n.id).sort(), ['orders/workflows/orderCheckout', 'workflows/checkout']);
    }
    assert.throws(() => ops.readLineWorkflows(root, 'nope'), refused('UNKNOWN_ITEM'));
  });

  test(`${kind}: base on, choose a page, add a When -> Do, remove it: each a staged change that lands through applyChange`, () => {
    const { ops, root } = make();
    const base = ops.planBaseWorkflowOn(root, BASE);
    assertStagedChange(base);
    assert.equal(base.summary, 'Creates the workflow orderBrowse in feature orders, based on the library workflow listDetail.');
    assert.deepEqual(base.files.map((f) => f.path), [FILE]);
    assert.match(base.files[0].content, /^\/\/ @line-base workflows\/listDetail\n/);
    assert.equal(ops.applyChange(root, base).ok, true);
    let w = ops.readLineWorkflows(root, 'orders').workflows[0];
    assert.deepEqual([w.id, w.base.libraryId, w.machineId], ['orders/workflows/orderBrowse', 'workflows/listDetail', 'orderBrowse']);
    assert.deepEqual(w.summary, ['orderBrowse is based on the library workflow listDetail.', '0 of 2 pages are chosen; still to choose: list and detail.', 'orders adds no transitions of its own yet.']);
    assert.ok(w.transitions.every((t) => t.origin === 'library' && !t.removable));
    assert.deepEqual(ops.readLineWorkflows(root, 'orders').library.find((x) => x.name === 'listDetail').usedBy, [{ feature: 'orders', file: FILE }]);

    const role = ops.planSetWorkflowRole(root, { file: FILE, role: 'list', page: 'OrdersPage' });
    assert.equal(role.summary, 'Chooses OrdersPage for the list page of the workflow orderBrowse.');
    assertApplyResult(ops.applyChange(root, role));
    w = ops.readLineWorkflows(root, 'orders').workflows[0];
    assert.deepEqual(w.roles.map((r) => [r.id, r.page, r.pageOk]), [['list', 'OrdersPage', true], ['detail', null, true]]);
    assert.equal(w.states.find((s) => s.id === 'list').label, 'OrdersPage');
    assert.equal(w.transitions[0].when, 'When OrdersPage sends OPEN.');

    const add = ops.planAddWorkflowTransition(root, { file: FILE, from: 'detail', event: 'CANCEL', to: 'list', service: 'cancelOrder' });
    assert.equal(add.summary, 'Adds to orderBrowse: when the detail page sends CANCEL, call the cancelOrder service, then go to OrdersPage.');
    assert.equal(ops.applyChange(root, add).ok, true);
    w = ops.readLineWorkflows(root, 'orders').workflows[0];
    const card = w.transitions.find((t) => t.id === 'detail|CANCEL');
    assert.deepEqual([card.origin, card.removable, card.do, card.actions], ['feature', true, 'Call the cancelOrder service, then go to OrdersPage.', [{ kind: 'callService', service: 'cancelOrder' }]]);
    assert.ok(w.summary.includes('orders adds one transition of its own.'));
    assertLineWorkflowList(ops.readLineWorkflows(root, 'orders'));

    const part = ops.planAddWorkflowTransition(root, { file: FILE, from: 'list', event: 'REFRESH', to: 'list', part: 'OrderCard', partState: 'loading' });
    assert.equal(part.summary, 'Adds to orderBrowse: when OrdersPage sends REFRESH, set OrderCard to loading.');

    const rm = ops.planRemoveWorkflowTransition(root, { file: FILE, from: 'detail', event: 'CANCEL' });
    assert.equal(rm.summary, 'Removes from orderBrowse: when the detail page sends CANCEL.');
    assert.equal(ops.applyChange(root, rm).ok, true);
    assert.equal(ops.readLineWorkflows(root, 'orders').workflows[0].transitions.some((t) => t.id === 'detail|CANCEL'), false);
  });

  test(`${kind}: refusals are one sentence with a code, and plan nothing`, () => {
    const { ops, root } = make();
    assert.throws(() => ops.planBaseWorkflowOn(root, { ...BASE, libraryId: 'components/Button' }), refused('UNKNOWN_ITEM'));
    assert.throws(() => ops.planBaseWorkflowOn(root, { ...BASE, name: 'order browse' }), refused('BAD_NAME'));
    assert.throws(() => ops.planBaseWorkflowOn(root, { ...BASE, feature: 'nope' }), refused('UNKNOWN_FEATURE'));
    ops.applyChange(root, ops.planBaseWorkflowOn(root, BASE));
    assert.throws(() => ops.planBaseWorkflowOn(root, BASE), refused('NAME_TAKEN'));
    assert.throws(() => ops.planSetWorkflowRole(root, { file: FILE, role: 'list', page: 'InvoicesPage' }), (e) => refused('UNKNOWN_PAGE')(e) && e.sentence === 'There is no page InvoicesPage in orders; pick one of its pages (OrdersPage).');
    assert.throws(() => ops.planSetWorkflowRole(root, { file: FILE, role: 'nope', page: 'OrdersPage' }), refused('UNKNOWN_ROLE'));
    assert.throws(() => ops.planSetWorkflowRole(root, { file: FILE, role: 'list', page: '' }), refused('NO_CHANGE'));
    assert.throws(() => ops.planSetWorkflowRole(root, { file: 'library/workflows/listDetail.ts', role: 'list', page: 'OrdersPage' }), refused('LIBRARY_ITEM'));
    assert.throws(() => ops.planAddWorkflowTransition(root, { file: FILE, from: 'list', event: 'OPEN', to: 'list' }), refused('BAD_TRANSITION'));
    assert.throws(() => ops.planAddWorkflowTransition(root, { file: FILE, from: 'list', event: 'GO', to: 'nowhere' }), refused('UNKNOWN_STATE'));
    assert.throws(() => ops.planAddWorkflowTransition(root, { file: FILE, from: 'list', event: 'bad event', to: 'detail' }), refused('BAD_EVENT'));
    assert.throws(() => ops.planAddWorkflowTransition(root, { file: FILE, from: 'list', event: 'GO', to: 'detail', part: 'OrderCard' }), refused('BAD_NAME'));
    assert.throws(() => ops.planRemoveWorkflowTransition(root, { file: FILE, from: 'list', event: 'OPEN' }), (e) => refused('LIBRARY_TRANSITION')(e) && e.sentence === 'The transition OPEN from list comes from the library workflow, so it stays; a feature only removes what it added.');
  });
}

test('real: the generated feature workflow passes validate --profile line, with its pages chosen as planned', () => {
  const root = copy();
  assert.equal(applyChange(root, WORKFLOW_OPS.planBaseWorkflowOn(root, BASE)).ok, true);
  assert.equal(applyChange(root, WORKFLOW_OPS.planSetWorkflowRole(root, { file: FILE, role: 'list', page: 'OrdersPage' })).ok, true);
  const add = WORKFLOW_OPS.planAddWorkflowTransition(root, { file: FILE, from: 'detail', event: 'CANCEL', to: 'list', service: 'cancelOrder', part: 'OrderCard', partState: 'loading' });
  assert.equal(applyChange(root, add).ok, true);
  assert.deepEqual(validateLine(root).violations.filter((v) => v.file === FILE), []);
  const src = fs.readFileSync(path.join(root, FILE), 'utf8');
  assert.match(src, /export const pages: Record<string, string \| null> = \{\n {2}list: 'OrdersPage',\n {2}detail: null,\n\};/);
  assert.match(src, /CANCEL: \{ target: 'list', actions: \[\{ type: 'callService', params: \{ service: 'cancelOrder' \} \}, \{ type: 'setPartState', params: \{ part: 'OrderCard', state: 'loading' \} \}\] \}/);
});

test('real: the machine Cockpit generates is a real xstate machine (createActor runs it)', async () => {
  const root = copy();
  assert.equal(applyChange(root, WORKFLOW_OPS.planBaseWorkflowOn(root, BASE)).ok, true);
  assert.equal(applyChange(root, WORKFLOW_OPS.planAddWorkflowTransition(root, { file: FILE, from: 'detail', event: 'CANCEL', to: 'list', service: 'cancelOrder' })).ok, true);
  // Load the generated .ts file as JS (its only TS is a few type annotations) and run it with xstate.
  const src = fs.readFileSync(path.join(root, FILE), 'utf8')
    .replace(/: Record<string, string \| null>/, '').replace(/_: unknown, _params: \{[^}]*\}/g, '_, params');
  const js = path.join(root, 'orderBrowse.mjs');
  fs.writeFileSync(js, src.replace(/\(_, params\) => \{\}/g, '(_, params) => globalThis.__lineCalls.push(params)'));
  const xstateDir = path.dirname(fileURLToPath(import.meta.resolve('xstate')));
  fs.symlinkSync(path.resolve(xstateDir, '..', '..'), path.join(root, 'node_modules'), 'dir');
  globalThis.__lineCalls = [];
  const { orderBrowse } = await import(js);
  const actor = createActor(orderBrowse).start();
  actor.send({ type: 'OPEN' });
  assert.equal(actor.getSnapshot().value, 'detail');
  actor.send({ type: 'CANCEL' });
  assert.equal(actor.getSnapshot().value, 'list');
  assert.deepEqual(globalThis.__lineCalls, [{ service: 'cancelOrder' }]);
  assert.ok(readMachine(src).ok);
});

test('real: promoting a feature workflow is line.promote: it moves into the library and is offered there', () => {
  const root = copy();
  assert.equal(applyChange(root, WORKFLOW_OPS.planBaseWorkflowOn(root, BASE)).ok, true);
  const r = applyChange(root, planPromote(root, { featureItemId: 'orders/workflows/orderBrowse' }));
  assert.equal(r.ok, true, r.sentence);
  const l = WORKFLOW_OPS.readLineWorkflows(root, 'billing');
  assert.deepEqual(l.library.find((w) => w.id === 'workflows/orderBrowse')?.roles.map((r) => r.id), ['list', 'detail'], 'its pages become the roles the next feature fills');
  assert.deepEqual(WORKFLOW_OPS.readLineWorkflows(root, 'orders').workflows, []);
});

test('plan tools: the four workflow tools are in the contract and the one registry, and a step runs with its checks', async () => {
  const names = ['line.baseWorkflowOn', 'line.setWorkflowRole', 'line.addWorkflowTransition', 'line.removeWorkflowTransition'];
  for (const n of names) assert.ok(LINE_PLAN_TOOLS.some((t) => t.name === n && t.kind === 'write'), n);
  const root = copy();
  const reg = createLinePlanRegistry({ root });
  assert.deepEqual(reg.list().filter((t) => names.includes(t.name)).map((t) => t.name), names);
  const made = await reg.call('line.baseWorkflowOn', BASE);
  assertLineStepResult(made);
  assert.deepEqual([made.passed, made.total, made.apply.files], [2, 2, [FILE]]);
  const role = await reg.call('line.setWorkflowRole', { file: FILE, role: 'list', page: 'OrdersPage' });
  assert.equal(role.needsYou, false);
  await assert.rejects(reg.call('line.addWorkflowTransition', { file: FILE, from: 'list', event: 'GO' }), /got arguments it cannot use: to/);
  const bad = await reg.call('line.setWorkflowRole', { file: FILE, role: 'list', page: 'Nope' });
  assert.equal(bad.needsYou, true);
  assert.equal(bad.apply.sentence, 'Nothing was saved: there is no page Nope in orders; pick one of its pages (OrdersPage).');
});
