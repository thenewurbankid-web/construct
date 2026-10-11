import test from 'node:test';
import assert from 'node:assert/strict';
import { routeCards, toDraftAnswer } from './RouteCards.ts';
import { answerAndRedraft } from '../workflows/AnswerFlow.ts';

const route = (id, status, extra = {}) => ({ id, label: `Do ${id}.`, risk: 'Changes only one feature.', status, sentence: 'Construct tried it on a copy of the project: every check passes.', via: 'template', confidence: 0.9, cost: { steps: 1, files: 1, layers: 1 }, steps: [{ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'OrdersBadge' } }], fix: null, ...extra });
const view = { ok: true, on: true, request: 'add a badge to orders', normalized: 'add a <library:L1> to <feature:F1>', intent: { id: 'add.component', confidence: 1, inCatalog: true }, routes: [route('a', 'ok'), route('b', 'refused', { sentence: 'Nothing was saved: no.', fix: { sentence: 'Create the folder.' } }), route('c', 'needs-model')], recommended: 'a', defer: { to: null, sentence: 'Confident.' }, questions: [], dropped: [] };

test('route cards: recommended first-class, only checked routes can be added, refusals keep their fix, details hold the calls', () => {
  const cards = routeCards(view);
  assert.deepEqual(cards.map((c) => [c.id, c.statusLabel, c.canAdd]), [['a', 'Recommended · Checked', true], ['b', 'Refused by Construct', false], ['c', 'Needs your input', false]]);
  assert.equal(cards[1].fix, 'Create the folder.');
  assert.equal(cards[0].calls[0], 'line.baseOn {"libraryId":"components/Badge","feature":"orders","name":"OrdersBadge"}');
  assert.equal(cards[0].how, 'Found by a Line rule; 1 step, 1 file; confidence 90%; route a.');
  assert.deepEqual(routeCards(null), []);
});

test('draft answers: a refusal is its sentence; an answered question re-drafts', async () => {
  assert.deepEqual(toDraftAnswer({ ok: false, sentence: 'The drafter is off.', code: 'DRAFTER_OFF' }), { ok: false, sentence: 'The drafter is off.', code: 'DRAFTER_OFF' });
  assert.equal(toDraftAnswer(null).ok, false);
  const calls = [];
  const api = { answer: async (w, k) => { calls.push(['answer', w, k]); return { ok: true, value: { sentence: 'Remembered.' } }; }, draft: async (r) => { calls.push(['draft', r]); return { ok: true, value: view }; } };
  const a = await answerAndRedraft(api, 'add a badge to the shop', 'shop', 'feature:orders');
  assert.equal(a.ok, true);
  assert.deepEqual(calls, [['answer', 'shop', 'feature:orders'], ['draft', 'add a badge to the shop']]);
});
