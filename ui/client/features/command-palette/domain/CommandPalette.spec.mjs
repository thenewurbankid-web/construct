import test from 'node:test';
import assert from 'node:assert/strict';
import { addCommands, removeCommands } from './CommandRegistry.ts';
import { filterCommands, scoreCommand } from './CommandSearch.ts';
import { flatten, groupCommands } from './CommandGroups.ts';
import { isPaletteShortcut, moveActive } from './PaletteKeys.ts';
import { initialPalette, paletteReducer } from '../workflows/PaletteState.ts';

const c = (id, title, group = 'G', keywords) => ({ id, title, group, keywords, run() {} });

test('addCommands appends, replaces by id in place, and does not mutate', () => {
  const a = [c('a', 'Alpha')];
  const b = addCommands(a, [c('b', 'Beta'), c('a', 'Alpha 2')]);
  assert.deepEqual(b.map((x) => x.title), ['Alpha 2', 'Beta']);
  assert.equal(a.length, 1);
});

test('removeCommands drops ids and keeps the same array when nothing matched', () => {
  const a = [c('a', 'A'), c('b', 'B')];
  assert.deepEqual(removeCommands(a, ['a']).map((x) => x.id), ['b']);
  assert.equal(removeCommands(a, ['zzz']), a);
});

test('scoring: prefix beats word-start beats substring beats keyword beats group beats fuzzy', () => {
  const s = (q, cmd) => scoreCommand(q, cmd);
  assert.equal(s('go', c('1', 'Go to Pages')), 100);
  assert.equal(s('pages', c('1', 'Go to Pages')), 80);
  assert.equal(s('ages', c('1', 'Go to Pages')), 60);
  assert.equal(s('layout', c('1', 'Toggle panes', 'View', ['layout'])), 40);
  assert.equal(s('view', c('1', 'Toggle panes', 'View')), 20);
  assert.equal(s('tgp', c('1', 'Toggle panes')), 10);
  assert.equal(s('zzz', c('1', 'Toggle panes')), null);
  assert.equal(s('', c('1', 'x')), 0);
});

test('every query token must match', () => {
  assert.notEqual(scoreCommand('go pages', c('1', 'Go to Pages')), null);
  assert.equal(scoreCommand('go nothing', c('1', 'Go to Pages')), null);
});

test('filterCommands: empty query keeps order; best match first; ties keep registration order', () => {
  const list = [c('1', 'Toggle drawer'), c('2', 'Go to Dashboard'), c('3', 'Run validate'), c('4', 'Go to Drawer docs')];
  assert.equal(filterCommands(list, '  '), list);
  // '1' and '4' are word-start matches (tie: registration order); '2' has no d-r-a subsequence.
  assert.deepEqual(filterCommands(list, 'dra').map((x) => x.id), ['1', '4']);
  assert.deepEqual(filterCommands(list, 'dbd').map((x) => x.id), ['2']); // fuzzy subsequence
  assert.deepEqual(filterCommands(list, 'run').map((x) => x.id), ['3']);
  assert.deepEqual(filterCommands(list, 'go').map((x) => x.id), ['2', '4']);
  assert.deepEqual(filterCommands(list, 'nope'), []);
});

test('filterCommands ranks a title prefix above a later substring', () => {
  const list = [c('a', 'Open pages'), c('b', 'Pages')];
  assert.deepEqual(filterCommands(list, 'pages').map((x) => x.id), ['b', 'a']);
});

test('groupCommands keeps first-appearance order; flatten matches display order', () => {
  const list = [c('1', 'a', 'X'), c('2', 'b', 'Y'), c('3', 'c', 'X')];
  const groups = groupCommands(list);
  assert.deepEqual(groups.map((g) => g.group), ['X', 'Y']);
  assert.deepEqual(flatten(groups).map((x) => x.id), ['1', '3', '2']);
});

test('moveActive wraps and handles empty lists', () => {
  assert.equal(moveActive(0, 3, 'ArrowDown'), 1);
  assert.equal(moveActive(2, 3, 'ArrowDown'), 0);
  assert.equal(moveActive(0, 3, 'ArrowUp'), 2);
  assert.equal(moveActive(1, 3, 'Home'), 0);
  assert.equal(moveActive(1, 3, 'End'), 2);
  assert.equal(moveActive(1, 3, 'a'), 1);
  assert.equal(moveActive(5, 0, 'ArrowDown'), 0);
});

test('isPaletteShortcut: Ctrl/Cmd+K only', () => {
  const k = (o) => ({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  assert.equal(isPaletteShortcut(k({ ctrlKey: true })), true);
  assert.equal(isPaletteShortcut(k({ metaKey: true, key: 'K' })), true);
  assert.equal(isPaletteShortcut(k({})), false);
  assert.equal(isPaletteShortcut(k({ ctrlKey: true, shiftKey: true })), false);
  assert.equal(isPaletteShortcut(k({ ctrlKey: true, altKey: true })), false);
  assert.equal(isPaletteShortcut(k({ ctrlKey: true, key: 'j' })), false);
});

test('paletteReducer: a new query resets the highlight; MOVE wraps; RESET clears', () => {
  let st = paletteReducer(initialPalette, { type: 'QUERY', query: 'go' });
  st = paletteReducer(st, { type: 'MOVE', key: 'ArrowDown', count: 3 });
  st = paletteReducer(st, { type: 'MOVE', key: 'ArrowDown', count: 3 });
  assert.equal(st.activeIndex, 2);
  st = paletteReducer(st, { type: 'MOVE', key: 'ArrowDown', count: 3 });
  assert.equal(st.activeIndex, 0);
  st = paletteReducer(st, { type: 'SET_ACTIVE', index: 2 });
  assert.equal(paletteReducer(st, { type: 'SET_ACTIVE', index: 2 }), st); // no-op keeps identity
  assert.equal(paletteReducer(st, { type: 'QUERY', query: 'x' }).activeIndex, 0);
  assert.deepEqual(paletteReducer(st, { type: 'RESET' }), initialPalette);
});
