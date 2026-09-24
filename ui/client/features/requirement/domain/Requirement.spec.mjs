import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequirement } from '../../../../../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../../../../../packages/core/placement.mjs';
import { toTimeline, screenOf } from './Timeline.ts';
import { EXAMPLES, withAnswer } from './Examples.ts';
import { noteDraftOf } from './NoteDraft.ts';
import { buildRequirementView } from './RequirementView.ts';
import { initialScreen, screenReducer } from '../workflows/RequirementMachine.ts';

// The placements are the REAL ones, from the core blocks, so the timeline is proven against what the server sends.
const placementOf = (text, answers) => placeCard(parseRequirement(text).card, { answers });
const [BILLING, UPLOAD, SEARCH] = EXAMPLES.map((e) => e.text);

test('the billing sentence reads back as six steps in run order, each with its owner and its checks', () => {
  const steps = toTimeline(placementOf(BILLING));
  assert.deepEqual(steps.map((s) => s.kind), ['page-load', 'server-read', 'presentation', 'interaction', 'mutation', 'redirect']);
  assert.deepEqual(steps.map((s) => s.order), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(steps.map((s) => s.blockId), [null, 'b1', 'b1-view', 'b2', 'b3', 'b3']);
  assert.equal(steps[0].line, 'The person opens the page "SubscriptionPlan".');
  assert.equal(steps[1].line, 'The server fetches "see current subscription plan" before anything is shown and first makes sure the person is signed in and the secret stays on the server.');
  assert.equal(steps[2].line, '"see current subscription plan" is drawn from the data it is given, with no data access of its own.');
  assert.equal(steps[3].line, 'In the browser, the person acts: "click button".');
  assert.match(steps[4].line, /^The server changes data for "manage billing details Stripe" and first makes sure the person is signed in and the secret stays on the server\.$/);
  assert.equal(steps[5].line, 'Then the person is sent on, and only to an allow-listed address.');
  assert.deepEqual(steps[1].owner, ['domain SubscriptionPlan', 'service SubscriptionPlan', 'controller SubscriptionPlan']);
  assert.deepEqual(steps[4].checks, ['auth-session-check', 'server-only-secret'], 'the redirect is its own step, not a guard of the mutation');
  assert.deepEqual(steps[5].checks, ['validated-redirect']);
  for (const s of steps) assert.ok(s.line.length > 0 && s.title.length > 0);
});

test('the other two examples: a plain screen has no server steps and no redirect', () => {
  assert.deepEqual(toTimeline(placementOf(SEARCH)).map((s) => s.kind), ['page-load', 'presentation', 'interaction']);
  assert.deepEqual(toTimeline(placementOf(UPLOAD)).map((s) => s.kind), ['page-load', 'presentation', 'interaction', 'mutation']);
});

test('the timeline is a pure function of the placement: same input, same steps; a changed answer redraws it', () => {
  const p = placementOf('A user can click a button safely.', { 'q-server': 'mutation' });
  assert.deepEqual(toTimeline(p), toTimeline(structuredClone(p)));
  assert.deepEqual(toTimeline(p).map((s) => s.kind), ['page-load', 'interaction', 'mutation', 'redirect']);
  const other = placementOf('A user can click a button safely.', { 'q-server': 'server-read' });
  assert.deepEqual(toTimeline(other).map((s) => s.kind), ['page-load', 'server-read', 'presentation', 'interaction'], 'a server read brings its presentational companion');
});

test('nothing placed gives no steps (a word is still open, or the placement is null)', () => {
  assert.deepEqual(toTimeline(null), []);
  assert.deepEqual(toTimeline({ blocks: [] }), []);
  assert.deepEqual(toTimeline(placementOf('save a form')), [], 'a write with nothing to write to is a question first');
  assert.equal(screenOf([]), 'the screen');
});

test('an unknown check name is shown as it is, never dropped', () => {
  const p = placementOf(BILLING);
  const blocks = p.blocks.map((b) => (b.id === 'b1' ? { ...b, checkNames: ['some-new-check'] } : b));
  assert.match(toTimeline({ blocks })[1].line, /first makes sure some-new-check\.$/);
});

test('answers: card answers are appended in order, a placement answer replaces the earlier one', () => {
  const card = { id: 'o1', source: 'card' };
  const q = { id: 'q-server', source: 'placement' };
  const one = withAnswer([], card, 'interact');
  assert.deepEqual(one, [{ id: 'o1', option: 'interact' }]);
  const two = withAnswer(one, card, 'entity');
  assert.deepEqual(two.map((a) => a.id), ['o1', 'o1'], 'ids renumber on the server, so both stay, in order');
  const three = withAnswer(withAnswer(two, q, 'mutation'), q, 'server-read');
  assert.deepEqual(three.filter((a) => a.id === 'q-server'), [{ id: 'q-server', option: 'server-read' }]);
  assert.deepEqual(one, [{ id: 'o1', option: 'interact' }], 'the input is not changed');
});

test('the three examples are the sentences of the docs and are all readable without an open question', () => {
  assert.deepEqual(EXAMPLES.map((e) => e.id), ['billing', 'profile-picture', 'instant-search']);
  for (const e of EXAMPLES) assert.equal(parseRequirement(e.text).card.open.length, 0, e.id);
});

test('the reducer: new text starts over, a read replaces the result and clears the approval, failures keep the text', () => {
  let s = screenReducer(initialScreen, { type: 'TEXT', text: 'hello' });
  assert.equal(s.text, 'hello');
  s = screenReducer(s, { type: 'ANSWERS', answers: [{ id: 'o1', option: 'read' }] });
  s = screenReducer(s, { type: 'READ_LOADING' });
  assert.equal(s.read.status, 'loading');
  const result = { card: {}, placement: null, plan: null, files: {}, open: [], warnings: [], summary: { readBack: [], blocks: [] } };
  s = screenReducer(s, { type: 'READ_LOADED', result });
  s = screenReducer(s, { type: 'APPROVE_STARTED', processId: 'p-1' });
  assert.equal(s.approve.status, 'started');
  s = screenReducer(s, { type: 'READ_LOADED', result });
  assert.equal(s.approve.status, 'idle', 'a new read makes an old approval stale');
  s = screenReducer(s, { type: 'READ_LOADING' });
  assert.equal(s.read.result, result, 'the card stays on screen while a new one is read');
  s = screenReducer(s, { type: 'READ_FAILED', error: 'no' });
  assert.deepEqual([s.read.status, s.read.error, s.text], ['failed', 'no', 'hello']);
  assert.equal(screenReducer(s, { type: 'TEXT', text: 'hello' }), s, 'same text is no change');
  const fresh = screenReducer(s, { type: 'TEXT', text: 'other' });
  assert.deepEqual([fresh.text, fresh.answers, fresh.read.status], ['other', [], 'idle']);
  assert.equal(screenReducer(s, { type: 'NOTHING' }), s);
});

test('the view: counts, badges, checks with their word, blocks with the three answers and files, the timeline and the approval', () => {
  const card = parseRequirement(BILLING).card;
  const placement = placeCard(card);
  const planned = planFromBlocks(placement.blocks, { feature: 'subscription-plan', root: '/x' });
  const result = { card, placement, plan: planned.plan, files: planned.files, open: [], warnings: [], summary: { readBack: ['a'], blocks: ['b'] } };
  const state = { ...initialScreen, text: BILLING, read: { status: 'ready', result, error: null } };
  const v = buildRequirementView(state);
  assert.equal(v.canRead, true);
  assert.equal(v.result.card.counts, '5 nouns, 3 verbs, 3 checks');
  assert.deepEqual(v.result.card.nouns.map((n) => n.kindLabel), ['State', 'Data', 'Screen part', 'Data', 'Outside service']);
  assert.deepEqual(v.result.card.verbs.map((x) => [x.kindLabel, x.acts]), [['Read', 'current subscription plan'], ['Interact', 'button'], ['Write', 'billing details, Stripe']]);
  assert.deepEqual(v.result.card.checks.map((c) => `${c.from}:${c.name}`), ['safely:auth-session-check', 'safely:server-only-secret', 'safely:validated-redirect']);
  assert.deepEqual(v.result.blocks.map((b) => b.kindLabel), ['Server read', 'Presentational', 'Client leaf', 'Mutation']);
  assert.deepEqual(v.result.blocks[3].answers.map((a) => a.answer), ['No', 'Yes', 'Yes']);
  assert.ok(v.result.blocks[0].files.every((f) => f.startsWith('features/subscription-plan/')));
  assert.equal(v.result.timeline.length, 6);
  assert.equal(v.result.files.length, new Set(Object.values(planned.files).flat()).size);
  assert.equal(new Set(v.result.files).size, v.result.files.length, 'every file once');
  assert.equal(v.result.approve.canApprove, true);
  assert.equal(v.result.approve.hint, null);
});

test('the view: an open question blocks Approve and hides the placement; running or started blocks a second approval', () => {
  const card = parseRequirement('A customer wants to frobnicate the invoice list.').card;
  const open = [{ id: 'o1', question: 'What does "frobnicate" do?', source: 'card', options: [{ id: 'read', label: 'Shows it', enabled: true, why: 'w' }, { id: 'x', label: 'Off', enabled: false, why: 'w' }] }];
  const result = { card, placement: null, plan: null, files: {}, open, warnings: [], summary: { readBack: [], blocks: [] } };
  const v = buildRequirementView({ ...initialScreen, text: 'x', read: { status: 'ready', result, error: null } });
  assert.equal(v.result.blocks, null);
  assert.deepEqual(v.result.timeline, []);
  assert.deepEqual(v.result.open[0].options.map((o) => o.id), ['read'], 'a disabled option is not offered');
  assert.equal(v.result.approve.canApprove, false);
  assert.equal(v.result.approve.hint, 'Answer 1 open question first.');
  assert.equal(buildRequirementView(initialScreen).canRead, false);
  assert.equal(buildRequirementView({ ...initialScreen, text: 'x', read: { status: 'loading', result: null, error: null } }).busy, true);
  const planned = { ...result, open: [], plan: { steps: [] } };
  const running = buildRequirementView({ ...initialScreen, text: 'x', read: { status: 'ready', result: planned, error: null }, approve: { status: 'running', processId: null, error: null } });
  assert.equal(running.result.approve.canApprove, false);
});

test('Save as note keeps the sentence, the read-back and the plan, with a short title', () => {
  const result = { summary: { readBack: ['line one', 'line two'], blocks: ['block one'] }, plan: { version: 1 } };
  const d = noteDraftOf(`  ${BILLING}  `, result);
  assert.ok(d.title.length <= 60 && d.title.endsWith('...'));
  assert.equal(d.body, `${BILLING}\n\nline one\nline two\n\nPlacement:\nblock one`);
  assert.deepEqual(d.plan, { version: 1 });
  assert.equal(noteDraftOf('Short one.', { summary: { readBack: [], blocks: [] }, plan: null }).body, 'Short one.');
});
