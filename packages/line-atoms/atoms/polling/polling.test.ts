import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, polling, backoffDelay } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
type Job = { state: 'running' | 'done' };
const input = { interval: 1000, maxBackoff: 5000, maxFailures: 3, isDone: (j: Job) => j.state === 'done' };

test('start, answers on an interval, done finishes, and a finished poll can start again', () => {
  let s = kit.init(input);
  assert.equal(s.status, 'stopped');
  assert.equal(kit.send(s, { type: 'STOP' }), s);
  assert.equal(kit.send(s, { type: 'TICK' }), s, 'no tick while stopped');
  assert.equal(kit.send(s, { type: 'RESOLVE', data: { state: 'running' } }), s, 'no answer while stopped');
  s = kit.send(s, { type: 'START' });
  assert.equal(s.status, 'fetching');
  assert.equal(kit.send(s, { type: 'START' }), s, 'already running');
  s = kit.send(s, { type: 'RESOLVE', data: { state: 'running' } });
  assert.equal(s.status, 'waiting');
  assert.equal(s.nextDelay, 1000);
  s = kit.send(s, { type: 'TICK' });
  s = kit.send(s, { type: 'RESOLVE', data: { state: 'done' } });
  assert.equal(s.status, 'finished');
  assert.equal(s.nextDelay, null);
  assert.equal(s.attempts, 2);
  s = kit.send(s, { type: 'START' });
  assert.equal(s.status, 'fetching');
  s = kit.send(s, { type: 'STOP' });
  assert.equal(s.status, 'stopped');
});

test('failures back off, doubling up to the cap, and too many in a row stop the poll', () => {
  let s = kit.send(kit.init(input), { type: 'START' });
  assert.equal(kit.send(s, { type: 'REJECT', error: 'x' }).nextDelay, 1000);
  s = kit.send(s, { type: 'REJECT', error: '500' });
  assert.equal(s.status, 'backoff');
  s = kit.send(s, { type: 'TICK' });
  s = kit.send(s, { type: 'REJECT', error: '500' });
  assert.equal(s.nextDelay, 2000);
  s = kit.send(s, { type: 'TICK' });
  s = kit.send(s, { type: 'REJECT', error: '500' });
  assert.equal(s.status, 'stopped', 'the third failure in a row gives up');
  assert.equal(s.error, '500');
  let w = kit.send(kit.init(input), { type: 'START' });
  w = kit.send(w, { type: 'RESOLVE', data: { state: 'running' } });
  w = kit.send(w, { type: 'STOP' });
  assert.equal(w.status, 'stopped');
  let b = kit.send(kit.init(input), { type: 'START' });
  b = kit.send(b, { type: 'REJECT', error: 'x' });
  b = kit.send(b, { type: 'STOP' });
  let f = kit.send(kit.init(input), { type: 'START' });
  f = kit.send(f, { type: 'RESOLVE', data: { state: 'done' } });
  f = kit.send(f, { type: 'STOP' });
  assert.equal(f.status, 'stopped');
});

test('a good answer clears the failure count; backoffDelay and polling() in one call', () => {
  assert.equal(backoffDelay(1000, 1, 5000), 1000);
  assert.equal(backoffDelay(1000, 3, 5000), 4000);
  assert.equal(backoffDelay(1000, 9, 5000), 5000);
  const s = polling(input, [{ error: 'x' }, { error: 'x' }, { data: { state: 'running' } }, { error: 'x' }, { error: 'x' }, { data: { state: 'done' } }]);
  assert.equal(s.status, 'finished', 'two failures, a good answer, two failures, then done: never three in a row');
  assert.equal(machine.init({ interval: 100 }).maxBackoff, 800);
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
