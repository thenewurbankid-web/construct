import test from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_CHANGE_VIEW } from '../../../../../packages/engine/line/knows/mock.mjs';
import { changeCards, changeSentence, progressAfterRun } from '../domain/ChangeCards.ts';
import { approveChange, planChange } from './PlanChange.ts';

const proposals = MOCK_CHANGE_VIEW.proposals;
const promote = proposals.find((p) => p.kind === 'promote');

/** A fake plan that records the calls; `run` lands unless told to refuse. */
function fakePlan({ refuseRun = false, refuseAdd = false } = {}) {
  const calls = [];
  const view = (state, stepId) => ({ ok: true, steps: [{ id: 's1', state, sentence: 'x.', error: refuseRun ? 'Construct refused it: the library already has an OrderButton.' : null }], ...(stepId ? { stepId } : {}) });
  return {
    calls,
    add: async (step) => { calls.push(['add', step]); return refuseAdd ? { ok: false, sentence: 'Only a person can do this.', code: 'X' } : view('waiting', 's1'); },
    approve: async (id) => { calls.push(['approve', id]); return view('ready'); },
    run: async (id) => { calls.push(['run', id]); return view(refuseRun ? 'needs-fix' : 'done'); },
  };
}

test('cards: the kind in words, proposed until planned, the item in focus first, the plan tool under Details', () => {
  const cards = changeCards(proposals, {}, null);
  assert.deepEqual(cards.map((c) => [c.kindLabel, c.state]), [['Re-base', 'proposed'], ['Move to the library', 'proposed']]);
  const focused = changeCards(proposals, {}, 'item:orders/components/OrderButton');
  assert.equal(focused[0].kind, 'promote');
  assert.ok(focused[0].details.includes('plan step: line.promote'));
  assert.equal(changeCards(proposals, { [promote.id]: { state: 'waiting', stepId: 's1', sentence: 'w.' } }, null)[1].stepId, 's1');
});

test('the tab sentence says when nothing is left to change', () => {
  assert.match(changeSentence([], null, 'x.'), /no change to propose/);
  assert.match(changeSentence(proposals, 'OrderButton', 'Line proposes 2 changes.'), /Changes for OrderButton come first\.$/);
});

test('Plan it adds ONE plan step with the typed fix (no other write); it waits for the person', async () => {
  const api = fakePlan();
  const r = await planChange(api, promote);
  assert.deepEqual(api.calls, [['add', { tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' }, why: promote.sentence }]]);
  assert.deepEqual([r.state, r.stepId], ['waiting', 's1']);
  assert.equal((await planChange(fakePlan({ refuseAdd: true }), promote)).sentence, 'Only a person can do this.');
});

test('Approve approves then runs that one step; done, or refused with Construct\'s sentence', async () => {
  const api = fakePlan();
  const r = await approveChange(api, 's1');
  assert.deepEqual(api.calls, [['approve', 's1'], ['run', 's1']]);
  assert.equal(r.state, 'done');
  const no = await approveChange(fakePlan({ refuseRun: true }), 's1');
  assert.deepEqual([no.state, no.sentence], ['refused', 'Construct refused it: the library already has an OrderButton.']);
  assert.equal(progressAfterRun(undefined, 'Nothing ran').sentence, 'Nothing ran.');
  const crash = await approveChange({ approve: async () => { throw new Error('x'); } }, 's1');
  assert.match(crash.sentence, /did not answer/);
});
