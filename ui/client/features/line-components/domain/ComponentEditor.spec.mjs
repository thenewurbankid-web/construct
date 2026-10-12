// cu4 -- the Components editor's pure half: the plan step of each edit tool, the state graph laid out by the shared
// workflow diagram, and a refusal with its typed fix. Uses the real engine's view of OrderDetails (examples/line-sample
// plus fixtures/line-cu4) so the client builds steps from exactly what the server sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_OPS, readLineComponent, studioEditor } from '../../../../../packages/engine/line/components.mjs';
import { applyChange } from '../../../../../packages/engine/line/ops.mjs';
import { workflowDiagram } from '../../line-workflows/domain/WorkflowDiagram.ts';
import { componentSteps } from './ComponentSteps.ts';
import { EDITOR_TABS, canCreate, headline, noticeOf, stateGraph, suggestName, tabOf } from './ComponentView.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const FILE = 'features/orders/components/OrderDetails.tsx';
const linked = studioEditor().ok ? {} : { skip: 'Studio is not linked here' };

/** OrderDetails with the disclosure attached, as the server reads it. */
function editor() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cu4-client-'));
  fs.cpSync(path.join(REPO, 'examples/line-sample'), root, { recursive: true });
  for (const sub of ['library', 'features']) fs.cpSync(path.join(REPO, 'fixtures/line-cu4', sub), path.join(root, sub), { recursive: true });
  applyChange(root, COMPONENT_OPS.planAttachComponentPrimitive(root, { file: FILE, primitive: 'disclosure' }));
  return readLineComponent(root, FILE);
}

test('tabs: Behaviour, Events, States; an unknown tab in the URL opens Behaviour', () => {
  assert.deepEqual(EDITOR_TABS.map((t) => t.label), ['Behaviour', 'Events', 'States']);
  assert.equal(tabOf('events'), 'events');
  assert.equal(tabOf('nope'), 'behaviour');
  assert.equal(tabOf(null), 'behaviour');
});

test('each edit tool is one plan step with the contract\'s arguments', linked, () => {
  const c = editor();
  assert.deepEqual(componentSteps.attach({ ...c, behaviour: { primitives: [], fits: [{ primitive: 'toggle', reason: '', mapping: { state: 'open' } }] } }, 'toggle'), { tool: 'line.attachComponentPrimitive', args: { file: FILE, primitive: 'toggle', mapping: { state: 'open' } } });
  const step = componentSteps.whenDo(c, 'click:trigger', 'primitive:disclosure-1:toggle');
  assert.deepEqual(step, { tool: 'line.addComponentEvent', args: { file: FILE, source: { kind: 'click', slot: 'trigger' }, action: { kind: 'primitive', primitive: 'disclosure-1', action: 'toggle' } } });
  assert.equal(componentSteps.whenDo(c, 'click:nope', 'primitive:disclosure-1:toggle'), null);
  assert.deepEqual(componentSteps.change(c, 'ev-1', 'set:open:true'), { tool: 'line.changeComponentEvent', args: { file: FILE, id: 'ev-1', action: { kind: 'set', prop: 'open', value: true } } });
  assert.equal(componentSteps.change(c, 'ev-1', 'nope'), null);
  const group = { key: 'k', label: 'Click on the trigger', sentence: '', actions: [], conflicts: ['x'], fix: { label: 'Use toggle instead', sentence: '', remove: ['ev-1', 'ev-2'], add: [{ source: { kind: 'click', slot: 'trigger' }, action: { kind: 'primitive', primitive: 'disclosure-1', action: 'toggle' } }] } };
  assert.deepEqual(componentSteps.fix(c, group).args.remove, ['ev-1', 'ev-2']);
  assert.equal(componentSteps.fix(c, { ...group, fix: null }), null);
  assert.deepEqual(componentSteps.setState(c, 'disclosure-1', 'open'), { tool: 'line.setComponentState', args: { file: FILE, ref: 'disclosure-1', state: 'open' } });
  assert.deepEqual(componentSteps.newComponent('components/Disclosure', 'billing', ' InvoiceDetails '), { tool: 'line.newComponent', args: { libraryId: 'components/Disclosure', feature: 'billing', name: 'InvoiceDetails' } });
});

test('the state graph reuses the workflow layout and marks the current state', linked, () => {
  const c = editor();
  const g = stateGraph(c.behaviour.primitives[0].diagram, workflowDiagram);
  assert.deepEqual(g.nodes.map((n) => [n.id, n.current]).sort(), [['closed', true], ['open', false]]);
  assert.ok(g.edges.length >= 2);
  assert.match(g.text[0], /^Now: closed\.$/);
  assert.equal(headline(c), 'OrderDetails: a component of orders, based on Disclosure.');
});

test('a refusal shows its sentence, its code for Details and each typed fix as a step; a step shows its sentence', () => {
  const n = noticeOf({ ok: false, sentence: 'Disclosure is a library component, which stays complete and is never changed here; base a feature item on it and change that.', code: 'LIBRARY_ITEM', fixes: [{ id: 'f', sentence: 'Base a new feature component BillingDisclosure in billing on Disclosure, then change that.', rank: 1, step: { tool: 'line.baseOn', args: { libraryId: 'components/Disclosure', feature: 'billing', name: 'BillingDisclosure' } } }] });
  assert.equal(n.ok, false);
  assert.equal(n.refusal.code, 'LIBRARY_ITEM');
  assert.deepEqual(n.refusal.fixes.map((f) => [f.step.tool, f.recommended]), [['line.baseOn', true]]);
  assert.deepEqual(noticeOf({ ok: true, sentence: 'Waiting for your approval: x.' }), { ok: true, sentence: 'Waiting for your approval: x.' });
});

test('New component: the suggested name and when the form can be sent', () => {
  assert.equal(suggestName('orders', 'Disclosure'), 'OrdersDisclosure');
  assert.equal(canCreate('components/Disclosure', 'orders', 'OrderPanel'), true);
  assert.equal(canCreate('components/Disclosure', 'orders', 'orderPanel'), false);
  assert.equal(canCreate('', 'orders', 'OrderPanel'), false);
});
