import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { chatMessageProblems, chatOptionProblems } from '../../../lib/lineChat.ts';
import { LIST_OPTIONS, itemOptions } from './ChatOptions.ts';
import { fixPick, fixStep } from './FixActions.ts';
import { basePick, nameAsk } from './ItemActions.ts';
import { itemExplain, itemIntro, itemMissing } from './ItemAnswers.ts';
import { createPick, importAnswer } from './ListActions.ts';
import { listExplain, listIntro, listMissing } from './ListAnswers.ts';
import { stepAnswer } from './StepAnswer.ts';

const ops = () => createMockLineOps();
const project = () => ops().readLineProject('/mock');
const feature = (name) => ops().readLineFeature('/mock', name);

test('Features chat: the full-screen options are create, open, what is missing, import and explain, with stable ids', () => {
  assert.deepEqual(chatOptionProblems(LIST_OPTIONS), []);
  assert.deepEqual(LIST_OPTIONS.map((o) => [o.id, o.effect]), [['features.open', 'read'], ['features.missing', 'read'], ['features.create', 'plan'], ['features.import', 'navigate'], ['features.explain', 'read']]);
});

test('Features chat: the first message lists every feature to pick, with Trace status tones', () => {
  const m = listIntro(project());
  assert.deepEqual(chatMessageProblems(m), []);
  assert.equal(m.text, 'Your project has 2 features. Pick one to open it, or choose what to do below.');
  assert.deepEqual(m.pick.items.map((i) => [i.id, i.status.tone, i.status.label]), [['billing', 'gap', 'Needs attention'], ['orders', 'fit', 'All fine']]);
  assert.equal(listIntro({ ...project(), features: [] }).text, 'This project has no features yet. Choose what to do below.');
});

test('Features chat: read answers (what is missing, explain, import) are plain English with technical lines under Details', () => {
  const missing = listMissing(project(), 'm1');
  assert.deepEqual(chatMessageProblems(missing), []);
  assert.match(missing.text, /^billing needs attention \(1 item\)\./);
  assert.deepEqual(missing.pick.items.map((i) => i.id), ['billing']);
  assert.ok(missing.details.every((d) => /^LINE-[A-Z]+ \S+:\d+$/.test(d)));
  assert.match(listExplain(project(), 'm2').text, /based on exactly one library item/);
  assert.equal(importAnswer('m3').link.href, '/import');
  assert.match(createPick(project(), 'm4').text, /^Which feature should the new item go in\?/);
});

test('Features chat: the side panel offers missing, explain, add, fix and back; fix only when a typed fix exists', () => {
  const billing = itemOptions(feature('billing'));
  assert.deepEqual(chatOptionProblems(billing), []);
  assert.deepEqual(billing.map((o) => o.id), ['feature.missing', 'feature.explain', 'feature.add', 'feature.fix', 'feature.back']);
  assert.equal(billing.find((o) => o.id === 'feature.fix').disabled, undefined);
  assert.equal(itemOptions(feature('orders')).find((o) => o.id === 'feature.fix').disabled, 'Nothing here has a fix Construct can apply.');
  assert.match(itemIntro('orders').text, /^orders is open beside this chat\./);
});

test('Features chat: what is missing in a feature names its problems and uncovered spec points', () => {
  const m = itemMissing(feature('billing'), 'm');
  assert.deepEqual(chatMessageProblems(m), []);
  assert.match(m.text, /a feature may use only the library/);
  assert.match(m.text, /Pick Fix what is wrong to apply a suggested fix\.$/);
  assert.match(itemMissing(feature('orders'), 'm').text, /Not covered yet: /);
  assert.deepEqual(chatMessageProblems(itemExplain(feature('orders'), 'e')), []);
});

test('Features chat: add from the library picks a library item, then suggests a name; a fix becomes a line.fix plan step', () => {
  const pick = basePick(project(), 'orders', 'b');
  assert.deepEqual(pick.pick.items.map((i) => i.id), ['components/Button', 'components/Dialog', 'components/TextField', 'pages/ListPage', 'workflows/listDetail', 'workflows/wizard']); // cw1 added library workflows to the mock
  assert.deepEqual(nameAsk('components/Button', 'orders'), { id: 'name:components/Button', label: 'What should the new component be called?', suggestion: 'OrdersButton', submit: 'Add to plan' });
  assert.equal(nameAsk('workflows/checkout', 'orders').suggestion, 'ordersCheckout');
  const fixes = fixPick(feature('billing'), 'f');
  assert.equal(fixes.pick.items[0].name, 'Recommended fix');
  assert.deepEqual(fixStep(fixes.pick.items[0].id), { tool: 'line.fix', args: { findingKey: 'LINE-DIR|features/billing/pages/InvoicesPage.tsx|3', fixId: 'LINE-DIR/promote' } });
});

test('Features chat: a plan step answer says to approve it; a refusal keeps its sentence and puts the code under Details', () => {
  assert.equal(stepAnswer({ ok: true, sentence: 'Waiting for your approval: Creates X.' }, 'line.baseOn({})', 's').text, 'Waiting for your approval: Creates X. Approve it in the Plan below.');
  const r = stepAnswer({ ok: false, sentence: 'Feature "orders" already has a component named X; pick another name.', code: 'NAME_TAKEN' }, 'line.baseOn({})', 's');
  assert.equal(r.tone, 'refusal');
  assert.deepEqual(r.details, ['line.baseOn({})', 'code: NAME_TAKEN']);
});
