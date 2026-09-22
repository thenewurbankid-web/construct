import test from 'node:test';
import assert from 'node:assert/strict';
import { startTimer, elapsedSeconds, formatDuration } from '../packages/core/timing.mjs';

test('elapsedSeconds returns a non-negative number', () => {
  const t = startTimer();
  const dt = elapsedSeconds(t);
  assert.equal(typeof dt, 'number');
  assert.ok(dt >= 0, `expected a non-negative elapsed time, got ${dt}`);
  assert.ok(Number.isFinite(dt));
});

test('elapsedSeconds grows (or stays equal) across two calls against the same start', async () => {
  const t = startTimer();
  const first = elapsedSeconds(t);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = elapsedSeconds(t);
  assert.ok(second >= first, `expected elapsed time to not go backwards (${first} -> ${second})`);
});

test('formatDuration renders a two-decimal seconds string', () => {
  assert.equal(formatDuration(0), '0.00s');
  assert.equal(formatDuration(0.02), '0.02s');
  assert.equal(formatDuration(8.345), '8.35s');
  assert.equal(formatDuration(1), '1.00s');
});
