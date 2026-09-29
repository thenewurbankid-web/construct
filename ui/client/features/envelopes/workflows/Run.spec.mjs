import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRun, runReducer } from './Run.ts';

test('a clean run: loading -> started, carrying the processId and any local-model steps', () => {
  const loading = runReducer(initialRun, { type: 'LOADING' });
  assert.equal(loading.status, 'loading');
  const started = runReducer(loading, { type: 'STARTED', processId: 'proc-1', models: ['s2'] });
  assert.equal(started.status, 'started');
  assert.equal(started.processId, 'proc-1');
  assert.deepEqual(started.models, ['s2']);
});

test('a failure carries its error and clears on the next LOADING', () => {
  const failed = runReducer(initialRun, { type: 'FAILED', error: 'not valid' });
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'not valid');
  const retried = runReducer(failed, { type: 'LOADING' });
  assert.equal(retried.status, 'loading');
  assert.equal(retried.error, null);
});

test('RESET returns to the initial state', () => {
  const started = runReducer(initialRun, { type: 'STARTED', processId: 'x', models: [] });
  assert.deepEqual(runReducer(started, { type: 'RESET' }), initialRun);
});
