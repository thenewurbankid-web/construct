import test from 'node:test';
import assert from 'node:assert/strict';
import { chatMessageProblems, chatOptionProblems } from './lineChat.ts';

const ok = { id: 'features.open', label: 'Open a feature', sentence: 'Pick a feature to open its page.', effect: 'read' };

test('chat contract: options carry stable dotted ids, a label, a full sentence and a known effect', () => {
  assert.deepEqual(chatOptionProblems([ok, { ...ok, id: 'feature.add', effect: 'plan' }]), []);
  assert.deepEqual(chatOptionProblems([{ ...ok, id: 'Open' }]), ['Option id "Open" is not a stable dotted id such as "features.open".']);
  assert.deepEqual(chatOptionProblems([ok, ok]), ['Option id "features.open" is used twice.']);
  assert.deepEqual(chatOptionProblems([{ ...ok, sentence: 'open it' }]), ['Option "features.open" does not explain itself in a full sentence.']);
  assert.deepEqual(chatOptionProblems([{ ...ok, effect: 'write' }]), ['Option "features.open" has an unknown effect "write".']);
  assert.deepEqual(chatOptionProblems([{ ...ok, disabled: 'no' }]), ['Option "features.open" is disabled without a full sentence saying why.']);
});

test('chat contract: a Line message is a full sentence and its pickable items have unique ids', () => {
  assert.deepEqual(chatMessageProblems({ id: 'm1', from: 'line', text: 'Here are your features.' }), []);
  assert.deepEqual(chatMessageProblems({ id: 'm2', from: 'you', text: 'open orders' }), []);
  assert.deepEqual(chatMessageProblems({ id: 'm3', from: 'line', text: 'no stop' }), ['Message "m3" is not a full sentence: "no stop".']);
  const item = { id: 'orders', name: 'orders', text: 'Fine.' };
  assert.deepEqual(chatMessageProblems({ id: 'm4', from: 'line', text: 'Pick one.', pick: { label: 'Features', items: [item, item] } }), ['Item id "orders" is used twice in message "m4".']);
});
