// "What Line knows", Memory tab (pure): what Line remembered per AI step, in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockKnows, MOCK_MEMORY_RECORDS } from '../../../../../packages/engine/line/knows/mock.mjs';
import { MEMORY_STEPS } from '../../../../../packages/engine/line/memory/contract.mjs';
import { TEMPLATE_PHRASE } from '../../../../../packages/engine/line/memory/words.mjs';
import { intentPhrase } from '../../../../../packages/engine/line/drafter/contract.mjs';
import { memoryTabView, optionWords, intentWords, outcomeWords, stepLabel, logLine, parseMemoryFile, exportFileName, ROUTE_WORDS, STEP_LABELS } from './MemoryTab.ts';

const view = () => createMockKnows().records();

test('the client words mirror the engine: step labels, route phrases and intent phrases', () => {
  assert.deepEqual(STEP_LABELS, MEMORY_STEPS);
  assert.deepEqual(ROUTE_WORDS, TEMPLATE_PHRASE);
  for (const id of ['add.component', 'promote.page', 'base-on.component', 'fix.problem', 'update.prop']) assert.equal(intentWords(id), intentPhrase(id), id);
  assert.equal(intentWords('use.item'), 'use item', 'an id outside the catalog reads as words');
});

test('optionWords: a route key, a tool, a fix id, else the key itself', () => {
  assert.equal(optionWords('via-library:ui:I>F'), 'via the library');
  assert.equal(optionWords('retrieval:base-on:ui:L>F'), 'a new item based on the library');
  assert.equal(optionWords('line.promote'), 'promote');
  assert.equal(optionWords('LINE-DIR:remove'), 'remove (LINE-DIR)');
  assert.equal(optionWords('something'), 'something');
});

test('outcomeWords: who did what, in plain words', () => {
  const r = (kind, chosen, by = 'person') => ({ ...MOCK_MEMORY_RECORDS[0], kind, chosen, by });
  assert.equal(outcomeWords(r('picked', 'via-library:ui:I>F')), "You picked 'via the library'");
  assert.equal(outcomeWords(r('refused', null)), "You refused 'via the library'");
  assert.equal(outcomeWords(r('edited', 'base-on:ui:L>F')), "You changed it to 'a new item based on the library'");
  assert.equal(outcomeWords(r('picked', 'base-on:ui:L>F', 'agent')), "An agent picked 'a new item based on the library'");
  assert.equal(outcomeWords(r('approved', 'line.promote', 'line')), "Line approved 'promote'");
});

test('memoryTabView: one row per record, the count of the same decision, the steps and the log in words', () => {
  const v = memoryTabView(view());
  assert.equal(v.rows.length, MOCK_MEMORY_RECORDS.length);
  const first = v.rows.find((r) => r.id === 'm-mock0001');
  assert.ok(first);
  assert.equal(first.stepLabel, 'Which drafted route you pick');
  assert.equal(first.intent, 'use item');
  assert.equal(first.outcome, "You picked 'via the library'");
  assert.equal(first.count, 3);
  assert.equal(first.when, '2026-10-11 09:12');
  assert.deepEqual(first.options, ['via-library:ui:I>F', 'base-on:ui:L>F']);
  assert.equal(first.chosen, 'via-library:ui:I>F');
  assert.equal(v.rows[0].id, 'm-mock0003', 'newest first (the third mock pick is dated 2026-10-13)');
  assert.deepEqual(v.steps.map((s) => [s.step, s.size]), [['drafter.route', 4], ['plan.fix', 1], ['plan.step', 1]]);
  assert.equal(v.embeddingsOn, false);
  assert.deepEqual(v.log, []);
  assert.match(v.sentence, /6 decisions/);
});

test('memoryTabView: the summary per step says how often, like "You picked \'via the library\' 3 times for \'use item\'."', () => {
  const v = memoryTabView(view());
  const sums = v.summaries ?? [];
  assert.ok(sums.some((s) => s.step === 'drafter.route' && s.text === "You picked 'via the library' 3 times for 'use item'."));
  assert.ok(sums.some((s) => s.text === "You picked 'a new item based on the library' once for 'Add a component'."));
});

test('memoryTabView: null (loading) is empty; the log reads as sentences, newest first', () => {
  const empty = memoryTabView(null);
  assert.deepEqual(empty.rows, []);
  const m = createMockKnows();
  m.forgetRecord({ id: 'm-mock0002' });
  m.setEmbeddings({ on: true });
  const v = memoryTabView(m.records());
  assert.equal(v.embeddingsOn, true);
  assert.equal(v.log.length, 2);
  assert.match(v.log[0], /^You turned embeddings on/);
  assert.match(v.log[1], /^You forgot one decision \(m-mock0002\)/);
  assert.equal(logLine({ at: '2026-10-12T08:00:00.000Z', by: 'person', action: 'forgetAll', target: 'all' }), 'You forgot everything Line remembered, 2026-10-12 08:00.');
  assert.equal(stepLabel('unknown.step'), 'unknown.step');
});

test('parseMemoryFile: a Line memory export, else one sentence; exportFileName is dated', () => {
  const m = createMockKnows();
  const text = JSON.stringify(m.exportMemory());
  const ok = parseMemoryFile(text);
  assert.equal(ok.ok, true);
  assert.equal(parseMemoryFile('not json').ok, false);
  assert.match(parseMemoryFile('{"v":1,"kind":"other"}').sentence, /not a Line memory file/);
  assert.equal(exportFileName(new Date('2026-10-12T10:00:00Z')), 'line-memory-2026-10-12.json');
});
