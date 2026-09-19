import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from './ErrorMessage.ts';

test('describeError: network failures become a backend-not-answering hint', () => {
  const d = describeError(new TypeError('Failed to fetch'), 'settings');
  assert.equal(d.title, 'Could not load settings');
  assert.match(d.hint, /backend did not answer/);
});

test('describeError: a real message is passed through; empty/unknown falls back', () => {
  assert.equal(describeError(new Error('Port 5173 is in use')).hint, 'Port 5173 is in use');
  assert.equal(describeError('boom', 'x').hint, 'boom');
  assert.match(describeError(undefined).hint, /backend did not answer/);
  assert.match(describeError({}).hint, /backend did not answer/);
});
