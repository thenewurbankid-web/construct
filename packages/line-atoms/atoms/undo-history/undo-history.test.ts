import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, undoHistory, canUndo, canRedo } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);

test('set, undo, redo through every combination', () => {
  let s = kit.init({ value: 'a' });
  assert.equal(s.status, 'clean');
  assert.equal(kit.send(s, { type: 'UNDO' }), s);
  assert.equal(kit.send(s, { type: 'REDO' }), s);
  assert.equal(kit.send(s, { type: 'CLEAR' }), s);
  assert.equal(kit.send(s, { type: 'SET', value: 'a' }), s, 'the same value records nothing');
  s = kit.send(s, { type: 'SET', value: 'b' });
  assert.equal(s.status, 'undoable');
  s = kit.send(s, { type: 'UNDO' });
  assert.equal(s.status, 'redoable');
  assert.equal(s.present, 'a');
  s = kit.send(s, { type: 'REDO' });
  assert.equal(s.status, 'undoable');
  assert.equal(s.present, 'b');
  s = kit.send(s, { type: 'SET', value: 'c' });
  s = kit.send(s, { type: 'UNDO' });
  assert.equal(s.status, 'both');
  s = kit.send(s, { type: 'UNDO' });
  assert.equal(s.status, 'redoable');
  s = kit.send(s, { type: 'REDO' });
  assert.equal(s.status, 'both');
  s = kit.send(s, { type: 'REDO' });
  assert.equal(s.status, 'undoable');
  assert.equal(s.present, 'c');
  s = kit.send(s, { type: 'SET', value: 'd' });
  s = kit.send(s, { type: 'UNDO' });
  s = kit.send(s, { type: 'UNDO' });
  assert.equal(s.status, 'both');
  s = kit.send(s, { type: 'UNDO' });
  s = kit.send(s, { type: 'REDO' });
  s = kit.send(s, { type: 'REDO' });
  assert.equal(s.status, 'both');
  s = kit.send(s, { type: 'SET', value: 'e' });
  assert.equal(s.status, 'undoable', 'a new value clears what could be redone');
  assert.equal(canRedo(s), false);
  s = kit.send(s, { type: 'UNDO' });
  s = kit.send(s, { type: 'CLEAR' });
  assert.equal(s.status, 'clean');
  assert.equal(s.present, 'c');
});

test('the history limit drops the oldest values', () => {
  const s = undoHistory(0, [1, 2, 3, 4, 5].map((v) => ({ type: 'SET' as const, value: v })), 3);
  assert.deepEqual(s.past, [2, 3, 4]);
  const back = undoHistory(0, [...[1, 2, 3, 4, 5].map((v) => ({ type: 'SET' as const, value: v })), { type: 'UNDO' as const }, { type: 'UNDO' as const }, { type: 'UNDO' as const }, { type: 'UNDO' as const }], 3);
  assert.equal(back.present, 2, 'only three changes can be undone');
  assert.equal(canUndo(back), false);
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
