import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, debouncedSearch, settledQuery, waitFor } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);

test('typing waits, more typing restarts the wait, quiet settles the query', () => {
  let s = kit.init({ delay: 300 });
  assert.equal(kit.send(s, { type: 'TICK', at: 1000 }), s, 'nothing is waiting');
  assert.equal(kit.send(s, { type: 'FLUSH' }), s);
  assert.equal(kit.send(s, { type: 'CLEAR' }), s, 'already empty');
  s = kit.send(s, { type: 'TYPE', text: 'm', at: 0 });
  assert.equal(s.status, 'waiting');
  assert.equal(waitFor(s, 100), 200);
  s = kit.send(s, { type: 'TYPE', text: 'mu', at: 200 });
  assert.equal(kit.send(s, { type: 'TICK', at: 400 }), s, 'not quiet long enough');
  s = kit.send(s, { type: 'TICK', at: 500 });
  assert.equal(s.status, 'settled');
  assert.equal(s.query, 'mu');
  assert.equal(waitFor(s, 600), null);
  s = kit.send(s, { type: 'TYPE', text: 'mug ', at: 900 });
  s = kit.send(s, { type: 'FLUSH' });
  assert.equal(s.query, 'mug', 'FLUSH settles at once, trimmed');
  s = kit.send(s, { type: 'CLEAR' });
  assert.equal(s.status, 'idle');
  assert.equal(s.delay, 300, 'CLEAR keeps the settings');
  s = kit.send(s, { type: 'TYPE', text: 'x', at: 0 });
  s = kit.send(s, { type: 'CLEAR' });
  assert.equal(s.query, '');
});

test('a minimum length: shorter text settles to an empty query', () => {
  assert.equal(settledQuery(' a ', 2), '');
  assert.equal(settledQuery('ab', 2), 'ab');
  assert.equal(debouncedSearch([{ text: 'm', at: 0 }], 1000, { minLength: 2 }), '');
});

test('debouncedSearch replays timed keystrokes', () => {
  assert.equal(debouncedSearch([{ text: 'c', at: 0 }, { text: 'ce', at: 100 }, { text: 'cer', at: 200 }], 499), '');
  assert.equal(debouncedSearch([{ text: 'c', at: 0 }, { text: 'ce', at: 100 }, { text: 'cer', at: 200 }], 500), 'cer');
  assert.equal(debouncedSearch([{ text: 'c', at: 0 }, { text: 'ca', at: 1000 }], 1100), 'c', 'a pause in between settles the first text');
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
