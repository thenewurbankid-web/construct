import test from 'node:test';
import assert from 'node:assert/strict';
import { pollIntervalMs, POLL_MS, POLL_STARTING_MS } from './DevServerPolling.ts';

test('the card is watched closely only while the server is starting', () => {
  assert.equal(pollIntervalMs('starting'), POLL_STARTING_MS);
  for (const s of [undefined, 'not-running', 'running', 'failed', 'stopping']) assert.equal(pollIntervalMs(s), POLL_MS);
  assert.ok(POLL_STARTING_MS < POLL_MS);
});
