import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOptionProblems, chatMessageProblems } from '../../../lib/lineChat.ts';
import { KNOWS_TABS, knowsMessage, knowsOptions, tabFromQuery, tabOfOption } from './KnowsTabs.ts';

test('four tabs in order, with stable ids the chat, Trace and tests pick them by', () => {
  assert.deepEqual(KNOWS_TABS.map((t) => t.id), ['map', 'memory', 'change', 'smart']);
  assert.deepEqual(KNOWS_TABS.map((t) => t.label), ['Map', 'Memory', 'Change', 'How smart is it']);
});

test('the chat options fit the chat contract; the open tab is disabled with a reason', () => {
  for (const t of KNOWS_TABS) {
    const o = knowsOptions(t.id);
    assert.deepEqual(chatOptionProblems(o), []);
    assert.equal(o.find((x) => x.id === `knows.${t.id}`).disabled, 'You are on this tab already.');
    assert.deepEqual(chatMessageProblems(knowsMessage(t.id, true)), []);
  }
  assert.equal(tabOfOption('knows.change'), 'change');
  assert.equal(tabOfOption('features.open'), null);
});

test('the URL picks the tab; anything else opens the Map', () => {
  assert.equal(tabFromQuery('smart'), 'smart');
  assert.equal(tabFromQuery('nope'), 'map');
  assert.equal(tabFromQuery(null), 'map');
});
