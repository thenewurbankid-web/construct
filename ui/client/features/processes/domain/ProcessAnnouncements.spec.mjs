import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSeenStates, stateChangeAnnouncements } from './ProcessAnnouncements.ts';

const summary = (over = {}) => ({
  id: 'p1', title: 'Add totals', state: 'running', stateDetail: 'running', pendingControl: null, currentStepId: null,
  progress: { done: 1, failed: 0, total: 4 }, modelSteps: 0, plannedModelSteps: 0, artifacts: 0, pendingApproval: 0,
  version: 1, createdAt: '2026-09-20T12:00:00.000Z', startedAt: null, finishedAt: null, terminal: false, controls: [], error: null, ...over,
});

test('a process seen for the first time is not announced', () => {
  assert.deepEqual(stateChangeAnnouncements([summary()], {}), []);
});

test('a state change since last seen is announced in plain words', () => {
  const seen = { p1: 'running' };
  assert.deepEqual(stateChangeAnnouncements([summary({ state: 'done' })], seen), ['Add totals: Done']);
  assert.deepEqual(stateChangeAnnouncements([summary({ state: 'running' })], seen), []);
});

test('nextSeenStates remembers every process it was given, keeping the ones it was not', () => {
  const seen = nextSeenStates([summary({ id: 'p1', state: 'running' })], { p2: 'done' });
  assert.deepEqual(seen, { p1: 'running', p2: 'done' });
  assert.deepEqual(nextSeenStates([summary({ id: 'p1', state: 'done' })], seen), { p1: 'done', p2: 'done' });
});
