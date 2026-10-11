// Train Line contract (packages/engine/line/train/contract.mjs): the shapes the server, the MCP tools and the Cockpit
// screen build against, checked over the mock; the closed lists; the delexicalization check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAIN_TOOLS, INTENTS, INTENT_IDS, TRAIN_API, assertTrainCase, assertTrainRoute, assertTryResult, assertScoreboard, assertDelexicalized, slotNamesIn,
} from '../packages/engine/line/train/contract.mjs';
import { createMockTrainService } from '../packages/engine/line/train/mock.mjs';
import { evaluate, describe } from '../packages/engine/line/expr.mjs';

test('train contract: only the five solid Line tools are offered, and every intent has a plain phrase and a family', () => {
  assert.deepEqual(TRAIN_TOOLS, ['line.baseOn', 'line.promote', 'line.setPageProp', 'line.setFragment', 'line.fix']);
  assert.equal(new Set(INTENT_IDS).size, INTENTS.length);
  for (const i of INTENTS) {
    assert.match(i.id, /^[a-z]+\.[a-z-]+$/);
    assert.match(i.phrase, /^[A-Z][^.]*$/);
    assert.ok([...TRAIN_TOOLS, 'none'].includes(i.family));
  }
  assert.deepEqual(TRAIN_API.map((r) => `${r.method} ${r.path}`), [
    'GET /api/line/train/worlds', 'GET /api/line/train/cases', 'GET /api/line/train/facts', 'POST /api/line/train/draft', 'POST /api/line/train/try', 'POST /api/line/train/preview', 'POST /api/line/train/route', 'POST /api/line/train/synonym',
    'POST /api/line/train/cases', 'POST /api/line/train/review', 'POST /api/line/train/eval', 'GET /api/line/train/scoreboard',
  ]);
});

test('train contract: the mock answers in the contract shapes (cases, draft, try, scoreboard)', () => {
  const svc = createMockTrainService();
  const { cases } = svc.cases({ filter: 'sample' });
  assert.equal(cases.length, 1);
  assertTrainCase(cases[0]);
  assert.equal(cases[0].filled.request, 'Make StatusBadge in orders, based on Badge.');
  const d = svc.draft({ request: 'Make StatusBadge in orders, based on Badge.' });
  d.routes.forEach((r) => assertTrainRoute(r, d.slots));
  assert.equal(d.recommended, 'inside');
  assertTryResult(svc.try({}));
  assertScoreboard(svc.scoreboard());
  assert.throws(() => svc.draft({ request: '' }), /Type what you want/);
});

test('train contract: only the owner agrees or disagrees; a disagreement marks the case disputed with a note', () => {
  const svc = createMockTrainService();
  assert.throws(() => svc.review({ id: 'tc-mock-claude', verdict: 'agree' }, 'claude'), /Only the owner/);
  const { case: c } = svc.review({ id: 'tc-mock-claude', verdict: 'disagree', note: 'The name should say what it shows.' });
  assert.equal(c.status, 'disputed');
  assertTrainCase(c);
  assert.equal(svc.scoreboard().total.agreement, 0);
  assert.deepEqual(svc.log.at(-1), { by: 'owner', action: 'disagree', caseId: 'tc-mock-claude' });
});

test('train contract: the shape checks refuse a case Cockpit must never store', () => {
  const svc = createMockTrainService();
  const c = svc.cases({}).cases[0];
  const { filled: _f, ...stored } = c;
  assert.throws(() => assertTrainCase({ ...stored, intent: 'make.anything' }), /intent catalog/);
  assert.throws(() => assertTrainCase({ ...stored, request: 'Make <name:N9> now.' }), /N9/);
  assert.throws(() => assertTrainCase({ ...stored, gold: { ...stored.gold, preferred: 'nope' } }), /preferred/);
  assert.throws(() => assertTrainCase({ ...stored, status: 'disputed' }), /owner's note/);
  assert.throws(() => assertTrainRoute({ ...stored.gold.routes[0], steps: [{ tool: 'line.moveFile', args: {} }] }, stored.slots), /one of line.baseOn/);
  assert.deepEqual(slotNamesIn(stored.request), ['N1', 'F1', 'L1']);
});

test('train contract: a stored case may hold no project word; slots pass, names fail (whole words, any case)', () => {
  assertDelexicalized('{"request":"Make <name:N1> in <feature:F1>, based on <library:L1>."}', ['orders', 'Badge', 'StatusBadge']);
  assert.throws(() => assertDelexicalized('{"request":"Make StatusBadge in <feature:F1>."}', ['StatusBadge']), /StatusBadge/);
  assert.throws(() => assertDelexicalized('{"text":"All Orders"}', ['orders']), /orders/);
  assertDelexicalized('{"text":"reorders"}', ['orders']);
});

test('expressions: Train Line\'s checks are named checks of Line\'s one expression language (failed sentences, [] when it holds)', () => {
  const facts = { files: {}, library: { 'components/Badge': { kind: 'components' } }, features: { orders: { spec: false, items: [{ id: 'orders/components/StatusBadge', base: 'components/Badge' }] } }, findings: [{ rule: 'LINE-DIR', file: 'a', key: 'LINE-DIR|a|1' }], findingsNew: [], plan: { tool: 'line.baseOn', staged: true, applied: false, files: [], refusal: { code: 'UNKNOWN_ITEM', rule: null, fixes: false } } };
  Object.defineProperty(facts, 'contents', { value: { a: 'title="X"' } });
  const failed = (e) => evaluate(facts, e).failed.map((f) => f.sentence);
  assert.deepEqual(failed({ and: [{ hasItem: 'orders/components/StatusBadge' }, { basedOn: ['orders/components/StatusBadge', 'components/Badge'] }, { noNewFindings: true }, { fileContains: ['a', 'title="X"'] }] }), []);
  assert.deepEqual(failed({ hasLibrary: 'components/Tag' }), ['Expected that the library has a component Tag, but it is not there.']);
  assert.equal(failed({ noFinding: { rule: 'LINE-DIR' } }).length, 1);
  assert.deepEqual(failed({ refused: { code: 'UNKNOWN_ITEM' } }), []);
  assert.equal(failed({ refused: { code: 'NAME_TAKEN' } }).length, 1);
  assert.equal(describe({ hasItem: 'orders/pages/OverviewListPage' }), 'orders has a page OverviewListPage.');
});
