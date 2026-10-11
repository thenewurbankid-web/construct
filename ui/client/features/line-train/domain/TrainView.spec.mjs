import test from 'node:test';
import assert from 'node:assert/strict';
import { percent, scoreLines } from './ScoreLines.ts';
import { slotChoices } from './SlotChoices.ts';
import { routeCards, caseCards } from './RouteCards.ts';
import { routeArgs, routeFields } from './RouteFields.ts';
import { caseView } from './CaseViews.ts';
import { startEdit, toggleValid, starRoute } from '../workflows/CorrectDraft.ts';
import { setSlot, withRoute } from '../workflows/DraftSlots.ts';
import { saveRequest } from '../workflows/SaveCase.ts';

const route = (id, label) => ({ id, label, scope: { layers: ['components'], features: ['F1'], library: false }, steps: [{ tool: 'line.baseOn', args: {} }], expect: [{ noNewFindings: true }], cost: 1, risk: 'low', outcome: 'change' });
const filled = (id, label) => ({ id, label, touches: 'Touches components in orders.', steps: [{ tool: 'line.baseOn', args: {}, sentence: 'Make StatusBadge in orders, based on the library Badge.' }], checks: ['Validate shows no new problems.'], cost: 1, risk: 'low', outcome: 'change', preferred: id === 'a' });
const draft = {
  request: 'Make <name:N1> in <feature:F1>, based on <library:L1>.', slots: { F1: { type: 'feature', ref: 'feature#1' }, L1: { type: 'library', ref: 'library:components#0', kind: 'components' }, N1: { type: 'name', role: 'status', of: 'L1' } },
  intent: 'add.component', intentPhrase: 'Add a component', via: 'retrieval', confidence: 1, unknown: [], routes: [route('a', 'Inside orders only'), route('b', 'Through the library')], recommended: 'a', world: 'sample',
  filled: { request: 'Make StatusBadge in orders, based on Badge.', routes: [filled('a', 'Inside orders only'), filled('b', 'Through the library')] }, values: { F1: 'orders', L1: 'Badge', N1: 'StatusBadge' },
};
const choices = {
  world: 'sample', label: 'The Line sample project', features: [{ ref: 'feature#0', name: 'billing' }, { ref: 'feature#1', name: 'orders' }],
  library: [{ ref: 'library:components#0', id: 'components/Badge', name: 'Badge', kind: 'components' }, { ref: 'library:pages#0', id: 'pages/ListPage', name: 'ListPage', kind: 'pages' }],
  items: [{ ref: 'item:feature#1/pages#0', id: 'orders/pages/OrdersPage', name: 'OrdersPage', kind: 'pages', feature: 'orders', file: 'features/orders/pages/OrdersPage.tsx' }],
  findings: [{ ref: 'finding#0', key: 'LINE-DIR|f|4', sentence: 'Feature billing uses orders.', fixes: [{ id: 'LINE-DIR/promote', sentence: 'Move OrderButton into the library.' }] }],
  fragments: {}, tools: [], intents: [], map: [], suggestions: [],
};

test('score lines: shares as percentages, "–" before eval, the total last, agreement with its counts', () => {
  assert.equal(percent(0.845), '85%');
  assert.equal(percent(null), '–');
  const row = { cases: 10, heldout: 2, recall: 1, precision: 0.5, preferred: 1, noRepair: 1, sampled: 3, agreed: 2, disagreed: 1, agreement: 0.67, label: 'Make from the library' };
  const s = scoreLines({ ok: true, lastRun: '2026-10-11T10:20:30.000Z', byFamily: { 'line.baseOn': row }, byIntent: {}, total: row, sentence: 'x.' });
  assert.deepEqual(s.lines.map((l) => [l.label, l.recall, l.precision, l.agreement]), [['Make from the library', '100%', '50%', '67% (2 of 3)'], ['All cases', '100%', '50%', '67% (2 of 3)']]);
  assert.equal(s.lastRun, 'Last run 2026-10-11 10:20 UTC.');
});

test('slot choices: each name the request uses is a closed choice of its kind, in the order the request names them', () => {
  const e = startEdit(draft);
  const s = slotChoices(e, choices, draft.values);
  assert.deepEqual(s.map((x) => [x.name, x.kind, x.current]), [['N1', 'text', 'StatusBadge'], ['F1', 'pick', 'feature#1'], ['L1', 'pick', 'library:components#0']]);
  assert.deepEqual(s[1].options.map((o) => o.label), ['billing', 'orders']);
  assert.deepEqual(s[2].options.map((o) => o.label), ['Badge'], 'only library items of the same kind');
});

test('correcting a draft: valid toggles, the star follows a valid route, a slot changes in one step, only valid routes are saved', () => {
  let e = startEdit(draft);
  assert.deepEqual([e.preferred, e.valid], ['a', { a: true, b: true }]);
  e = toggleValid(e, 'a');
  assert.deepEqual([e.preferred, e.valid.a], ['b', false], 'an invalid route loses the star');
  e = starRoute(e, 'a');
  assert.deepEqual([e.preferred, e.valid.a], ['a', true]);
  e = setSlot(e, 'F1', 'feature#0', 'pick');
  assert.equal(e.slots.F1.ref, 'feature#0');
  e = setSlot(e, 'N1', 'TotalBadge', 'text');
  assert.deepEqual(e.slots.N1, { type: 'name', literal: 'TotalBadge' });
  e = toggleValid(e, 'b');
  const r = saveRequest(e);
  assert.equal(r.ok, true);
  assert.deepEqual(r.req.routes.map((x) => x.id), ['a']);
  assert.equal(saveRequest(toggleValid(e, 'a')).sentence, 'Mark at least one route as valid, or add one, before saving.');
  const added = withRoute(e, { ...e.slots, L2: { type: 'library', ref: 'library:pages#0' } }, route('r-1', 'Yours'));
  assert.deepEqual([added.routes.length, added.valid['r-1'], added.slots.L2.ref], [3, true, 'library:pages#0']);
});

test('route cards: valid, starred and Try it result in words; a stored case reads "Proposed by Claude" until reviewed', () => {
  const e = toggleValid(startEdit(draft), 'b');
  const cards = routeCards(e, { a: { ok: false, sentence: 'It does not work.', steps: [], checks: [{ sentence: 'X.', ok: false }] } });
  assert.deepEqual(cards.map((c) => [c.id, c.valid, c.starred, c.starLabel, c.steps_n]), [['a', true, true, '★ Preferred', '1 step'], ['b', false, false, '☆ Prefer this', '1 step']]);
  assert.deepEqual(cards[0].tried.checks, [{ text: 'Fails: X.', ok: false }]);
  assert.equal(caseCards([filled('a', 'x')])[0].chip, 'Preferred');
  const c = { id: 'tc-1', intent: 'add.component', request: draft.request, slots: draft.slots, world: { kind: 'sample' }, split: 'train', gold: { routes: draft.routes, preferred: 'a' }, labelledBy: 'claude', status: 'draft', notes: [], sample: true, filled: { request: 'Make StatusBadge in orders, based on Badge.', intentPhrase: 'Add a component', routes: draft.filled.routes, world: 'The Line sample project' } };
  assert.deepEqual([caseView(c).by, caseView(c).canReview, caseView(c).statusLine], ['Proposed by Claude', true, '']);
  const disputed = caseView({ ...c, status: 'disputed', notes: [{ by: 'owner', text: 'Keep it in the feature.', at: 'x' }] });
  assert.deepEqual([disputed.canReview, disputed.statusLine], [false, 'You disagreed: Keep it in the feature.']);
});

test('add a route: the fields are closed choices from the project, and the args are the tool call', () => {
  assert.deepEqual(routeFields('line.baseOn', choices).map((f) => [f.key, f.kind]), [['libraryId', 'pick'], ['feature', 'pick'], ['name', 'text']]);
  const fields = routeFields('line.setPageProp', choices);
  assert.deepEqual(routeArgs('line.setPageProp', { prop: 'size', value: '50' }, fields), { file: 'features/orders/pages/OrdersPage.tsx', nodeId: 'n0', prop: 'size', kind: 'number', value: 50 });
  assert.deepEqual(routeArgs('line.fix', {}, routeFields('line.fix', choices)), { findingKey: 'LINE-DIR|f|4', fixId: 'LINE-DIR/promote' });
});
