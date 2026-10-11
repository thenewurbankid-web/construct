import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { workflowDiagram } from './WorkflowDiagram.ts';
import { suggestName, workflowCards } from './WorkflowCards.ts';
import { workflowSteps } from './WorkflowSteps.ts';
import { draftProblem, emptyDraft } from './WhenDoDraft.ts';

const { baseOn: baseOnStep, role: roleStep, whenDo: whenDoStep, remove: removeStep, promote: promoteStep } = workflowSteps;

const FILE = 'features/orders/workflows/ordersListDetail.ts';
/** The mock with orders' list-then-detail workflow started and its list page chosen. */
function started() {
  const ops = createMockLineOps();
  ops.applyChange('/mock', ops.planBaseWorkflowOn('/mock', { libraryId: 'workflows/listDetail', feature: 'orders', name: 'ordersListDetail' }));
  ops.applyChange('/mock', ops.planSetWorkflowRole('/mock', { file: FILE, role: 'list', page: 'OrdersPage' }));
  return ops.readLineWorkflows('/mock', 'orders');
}

test('workflowCards: each feature workflow says its base and how many of its pages are chosen', () => {
  assert.deepEqual(workflowCards(started()), [{ id: 'orders/workflows/ordersListDetail', name: 'ordersListDetail', base: 'Based on listDetail', pages: '1 of 2 pages chosen.', ok: false }]);
});

test('suggestName: the feature and the library name, numbered when taken', () => {
  const list = createMockLineOps().readLineWorkflows('/mock', 'orders');
  assert.equal(suggestName(list, 'listDetail'), 'ordersListDetail');
  assert.equal(suggestName(started(), 'listDetail'), 'ordersListDetail2');
});

test('steps: every change is a plan step with the contract\'s arguments; empty optional fields are left out', () => {
  const w = started().workflows[0];
  assert.deepEqual(baseOnStep('orders', 'workflows/wizard', 'ordersWizard'), { tool: 'line.baseWorkflowOn', args: { libraryId: 'workflows/wizard', feature: 'orders', name: 'ordersWizard' } });
  assert.deepEqual(roleStep(w, 'detail', 'OrdersPage'), { tool: 'line.setWorkflowRole', args: { file: FILE, role: 'detail', page: 'OrdersPage' } });
  assert.deepEqual(whenDoStep(w, { from: 'detail', event: ' cancel order ', to: 'list', service: 'cancelOrder', part: '', partState: '' }),
    { tool: 'line.addWorkflowTransition', args: { file: FILE, from: 'detail', event: 'CANCEL_ORDER', to: 'list', service: 'cancelOrder' } });
  assert.deepEqual(removeStep(w, 'detail|BACK'), { tool: 'line.removeWorkflowTransition', args: { file: FILE, from: 'detail', event: 'BACK' } });
  assert.deepEqual(promoteStep(w), { tool: 'line.promote', args: { featureItemId: 'orders/workflows/ordersListDetail' } });
  assert.deepEqual(emptyDraft(w), { from: 'list', event: '', to: 'list', service: '', part: '', partState: '' });
  assert.equal(draftProblem(emptyDraft(w)), 'Type the event the page sends, such as CANCEL.');
  assert.equal(draftProblem({ ...emptyDraft(w), event: 'GO', part: 'OrderCard' }), 'Name both the part and the state to set it to, or leave both empty.');
  assert.equal(draftProblem({ ...emptyDraft(w), event: 'GO' }), null);
});

test('workflowDiagram: the first state on the left, every transition an arrow, the same as sentences', () => {
  const d = workflowDiagram(started().workflows[0]);
  assert.deepEqual(d.nodes.map((n) => [n.id, n.label, n.sub, n.initial]), [['list', 'OrdersPage', 'list page', true], ['detail', 'the detail page', 'page not chosen', false]]);
  assert.ok(d.nodes[0].x < d.nodes[1].x);
  assert.deepEqual(d.edges.map((e) => [e.id, e.label, e.own]), [['list|OPEN', 'OPEN', false], ['detail|BACK', 'BACK', false]]);
  assert.deepEqual(d.text, ['When OrdersPage sends OPEN. Go to the detail page.', 'When the detail page sends BACK. Go to OrdersPage.']);
  assert.ok(d.width > 0 && d.height > 0);
});
