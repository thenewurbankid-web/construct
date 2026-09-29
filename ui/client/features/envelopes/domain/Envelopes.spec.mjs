import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelopesView } from './EnvelopesView.ts';
import { initialEnvelopes, envelopesReducer } from '../workflows/Envelopes.ts';

const flow = (name, overrides = {}) => ({ name, stepCount: 1, steps: [{ flow: 'create.unit' }], error: null, ...overrides });

test('reducer keeps the previous rows while running and after a failure', () => {
  const ready = envelopesReducer(initialEnvelopes, { type: 'RESULT', rows: [flow('scaffold-checkout')] });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.rows.length, 1);
  const running = envelopesReducer(ready, { type: 'RUN' });
  assert.equal(running.status, 'running');
  assert.equal(running.rows.length, 1, 'the previous result stays visible while re-running');
  const failed = envelopesReducer(running, { type: 'FAIL', error: 'boom' });
  assert.equal(failed.error, 'boom');
  assert.equal(failed.rows.length, 1);
  assert.equal(envelopesReducer(failed, { type: 'RUN' }).error, null);
});

test('buildEnvelopesView: idle, running (no previous rows) and error (no previous rows) states', () => {
  assert.equal(buildEnvelopesView(initialEnvelopes).summary, 'Not read yet');
  const running = envelopesReducer(initialEnvelopes, { type: 'RUN' });
  assert.equal(buildEnvelopesView(running).running, true);
  assert.match(buildEnvelopesView(running).summary, /Reading/);
  const failed = envelopesReducer(initialEnvelopes, { type: 'FAIL', error: 'nope' });
  assert.equal(buildEnvelopesView(failed).mode, 'error');
  assert.equal(buildEnvelopesView(failed).error, 'nope');
});

test('buildEnvelopesView: empty project (no flows saved yet)', () => {
  const empty = envelopesReducer(initialEnvelopes, { type: 'RESULT', rows: [] });
  assert.equal(buildEnvelopesView(empty).mode, 'empty');
});

test('buildEnvelopesView: list mode names the flow count in the summary', () => {
  const ready = envelopesReducer(initialEnvelopes, { type: 'RESULT', rows: [flow('a'), flow('b')] });
  const view = buildEnvelopesView(ready);
  assert.equal(view.mode, 'list');
  assert.equal(view.rows.length, 2);
  assert.match(view.summary, /2 saved flows/);
});

test('buildEnvelopesView: a failed re-run keeps the previous rows visible as a list with an error banner', () => {
  const ready = envelopesReducer(initialEnvelopes, { type: 'RESULT', rows: [flow('scaffold-checkout')] });
  const rerun = envelopesReducer(ready, { type: 'FAIL', error: 'again' });
  const view = buildEnvelopesView(rerun);
  assert.equal(view.mode, 'list');
  assert.equal(view.error, 'again');
  assert.equal(view.rows.length, 1);
});
