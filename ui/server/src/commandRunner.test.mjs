// #167: runCapturing wraps every Dashboard/Wizard command call with its own
// wall-clock total (durationSeconds) — a floor guarantee independent of
// whatever per-step timing text the wrapped command itself already printed
// into `output` (see #165/#166). These assert presence/shape/non-negativity
// only, never an exact value (timing is inherently variable).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCapturing } from './commandRunner.mjs';
import { ConstructError, EXIT_CODES } from '../../../src/diagnostics.mjs';

test('runCapturing reports a non-negative durationSeconds on success', async () => {
  const result = await runCapturing(async () => {
    console.log('did some work');
  });
  assert.equal(result.ok, true);
  assert.equal(typeof result.durationSeconds, 'number');
  assert.ok(result.durationSeconds >= 0);
  assert.ok(Number.isFinite(result.durationSeconds));
});

test('runCapturing still reports a non-negative durationSeconds when the wrapped command throws', async () => {
  const result = await runCapturing(async () => {
    console.log('partial progress before failing');
    throw new ConstructError('boom', { exitCode: EXIT_CODES.USAGE_ERROR });
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'boom');
  // The original error is never swallowed by timing instrumentation.
  assert.equal(result.httpStatus, 400);
  assert.equal(typeof result.durationSeconds, 'number');
  assert.ok(result.durationSeconds >= 0);
  // Whatever was already logged before the throw is still captured.
  assert.deepEqual(result.output, ['partial progress before failing']);
});

test('runCapturing durationSeconds reflects real elapsed time (grows for a slower command)', async () => {
  const fast = await runCapturing(async () => {});
  const slow = await runCapturing(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.ok(slow.durationSeconds >= fast.durationSeconds);
});
