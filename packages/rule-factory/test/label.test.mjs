// cs2 -- labelling: misses become closed questions with "none fits" last; jev answers through Line's one decide();
// with jev down the rules answer what they can and say so; a person's or Claude's offline JSONL is read back, refusing
// any answer outside the options.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLabelItem, NONE_FITS } from '../contract.mjs';
import { missesFromDrafts, missesFromTraces } from '../collect.mjs';
import { labelItemsOf, labelWithJev, labellingJsonl, importLabelling, wordOptions, rulesForWord, LABEL_STEP } from '../label.mjs';
import { createMockDecide } from '@line/construct-core/line-decide-mock';
import { stepProfile } from '@line/construct-core/ai-profiles';

const drafts = missesFromDrafts([
  { caseId: 'tc-1', request: '<feature:F1> should attach a <library:L1>.', intent: 'add.component', drafted: null, preferred: false, words: ['attach', 'nicely'] },
  { caseId: 'tc-2', request: '<item:I1> should list <number:V1> per page.', intent: 'update.prop', drafted: 'update.prop', preferred: false, words: ['size'] },
  { caseId: 'tc-3', request: 'Make <name:N1> in <feature:F1>.', intent: 'add.component', drafted: 'add.component', preferred: true, words: [] },
]);
const traces = missesFromTraces([
  { version: 'decision-trace.v1', id: 'dt-1', chooser: { id: 'pages-editor.quick-fix', question: 'How should the PAGE-003 violation be fixed?' }, options: ['mechanical', 'ai'], chosen: 'ai', by: 'person', suggestion: { option: 'mechanical' } },
  { version: 'decision-trace.v1', id: 'dt-2', chooser: { id: 'construct.next', question: 'What next?' }, options: ['a', 'b'], chosen: 'b', by: 'decision-model', provider: { name: 'reason' } },
]);

test('items: one per word the drafter could not read, one per missed choice with options; hits and option-less misses have none', () => {
  const items = labelItemsOf([...drafts, ...traces]);
  for (const it of items) assertLabelItem(it);
  assert.deepEqual(items.map((i) => i.id), ['drafter:tc-1:attach', 'drafter:tc-1:nicely', 'drafter:tc-2:size', 'trace:dt-1', 'trace:dt-2']);
  assert.deepEqual(wordOptions('update.handler').filter((o) => o.startsWith('handler:')), ['handler:log', 'handler:navigate', 'handler:call', 'handler:set']);
  assert.deepEqual(items[0].options, ['verb:add', 'verb:remove', 'verb:promote', 'verb:update', 'verb:fix', 'grammar', 'catalog:component', NONE_FITS]);
  assert.equal(items[3].labelledBy, 'person', 'a person who overrode static code labelled it already');
  assert.equal(items[3].correct, 'ai');
  assert.equal(items[4].labelledBy, null, 'a model\'s choice is not a label');
  assert.match(items[0].question, /^In ".*", what does "attach" stand for\?$/);
});

test('rules: a word in a request whose intent was read right is grammar; the first unread word of a missed verb is that verb; else unknown', () => {
  assert.equal(rulesForWord({ words: ['size'], intent: 'update.prop', drafted: 'update.prop' }, 'size'), 'grammar');
  assert.equal(rulesForWord({ words: ['attach', 'nicely'], intent: 'add.component', drafted: null }, 'attach'), 'verb:add');
  assert.equal(rulesForWord({ words: ['attach', 'nicely'], intent: 'add.component', drafted: null }, 'nicely'), null);
});

test('jev: the labelling step is a Line AI profile with jev on; jev labels every item without a person\'s answer', async () => {
  const p = stepProfile(LABEL_STEP);
  assert.equal(p.kind, 'decide');
  assert.equal(p.ladder.options.on, true);
  const d = createMockDecide({ pick: 0 });
  const r = await labelWithJev(labelItemsOf([...drafts, ...traces]), { decide: d.decide });
  assert.equal(r.via, 'jev');
  assert.deepEqual(r.by, { jev: 4, rules: 0, person: 1, claude: 0, unlabelled: 0 });
  assert.equal(r.items[0].correct, 'verb:add', 'jev picked the first option');
  assert.equal(r.agreement.both, 2, 'two items where the rules could tell');
  assert.match(r.sentence, /^jev labelled 4 of 5 misses/);
});

test('jev down: the rules label what they can, the rest stays for a person or Claude, and the sentence says why', async () => {
  const d = createMockDecide();
  const r = await labelWithJev(labelItemsOf([...drafts, ...traces]), { decide: d.decide });
  assert.equal(r.via, 'rules');
  assert.deepEqual(r.by, { jev: 0, rules: 2, person: 1, claude: 0, unlabelled: 2 });
  assert.match(r.sentence, /^jev was not available \(The reason module is mocked off; Line decided without jev\), so the rules labelled 2 of 5 misses and people 1\. 2 stay unlabelled/);
  const off = await labelWithJev(labelItemsOf(drafts), { off: 'it was turned off for this run with --no-jev' });
  assert.match(off.sentence, /^jev was not available \(it was turned off for this run with --no-jev\), so the rules labelled 2 of 3/);
  assert.equal((await labelWithJev([], { off: 'x' })).sentence, 'There were no misses with closed options to label.');
  const thrown = await labelWithJev(labelItemsOf(drafts), { decide: async () => { throw new Error('socket hang up'); } });
  assert.equal(thrown.via, 'rules');
  assert.match(thrown.sentence, /socket hang up/);
});

test('offline JSONL: written one item per line with plain option labels; filled answers come back; a wrong answer is refused', async () => {
  const items = labelItemsOf(drafts);
  const text = labellingJsonl(items);
  const lines = text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].optionLabels['verb:add'], 'It asks to add something');
  lines[0].correct = 'verb:add'; lines[0].labelledBy = 'claude';
  lines[1].correct = 'verb:shout'; lines[1].labelledBy = 'claude';
  lines[2].correct = 'grammar'; lines[2].labelledBy = 'qwen';
  const back = importLabelling([...lines.map((l) => JSON.stringify(l)), '{"id":"nope","correct":"grammar","labelledBy":"person"}', 'not json'].join('\n'), items);
  assert.equal(back.imported, 1);
  assert.equal(back.items[0].labelledBy, 'claude');
  assert.deepEqual(back.refused.map((x) => x.sentence), [
    'Line 2 answers "verb:shout", which is not one of its options.',
    'Line 3 must say it was labelled by a person or Claude.',
    'Line 4 names no miss Line knows.',
    'Line 5 is not JSON.',
  ]);
  const after = await labelWithJev(back.items, { decide: createMockDecide({ pick: 5 }).decide });
  assert.equal(after.items[0].correct, 'verb:add', 'Claude\'s answer stands over jev\'s');
});
