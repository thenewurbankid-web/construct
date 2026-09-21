// #167: runCapturing wraps every Dashboard/Wizard command call with its own
// wall-clock total (durationSeconds) — a floor guarantee independent of
// whatever per-step timing text the wrapped command itself already printed
// into `output` (see #165/#166). These assert presence/shape/non-negativity
// only, never an exact value (timing is inherently variable).
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCapturing, CommandTimeoutError, DEFAULT_COMMAND_TIMEOUT_SEC, resolveCommandTimeoutMs } from './commandRunner.mjs';
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

// ---- #413: a command that never settles cannot wedge the queue.

test('resolveCommandTimeoutMs: CONSTRUCT_COMMAND_TIMEOUT_SEC in seconds, default 900, nonsense ignored', () => {
  assert.equal(resolveCommandTimeoutMs({}), DEFAULT_COMMAND_TIMEOUT_SEC * 1000);
  assert.equal(resolveCommandTimeoutMs({ CONSTRUCT_COMMAND_TIMEOUT_SEC: '5' }), 5000);
  for (const bad of ['0', '-1', 'x']) assert.equal(resolveCommandTimeoutMs({ CONSTRUCT_COMMAND_TIMEOUT_SEC: bad }), DEFAULT_COMMAND_TIMEOUT_SEC * 1000);
});

test('a command that never settles is abandoned at the deadline with 504, and the next command still runs', async () => {
  let release;
  const hung = new Promise((r) => { release = r; });
  const started = Date.now();
  const result = await runCapturing(async () => {
    console.log('started, then hung');
    await hung;
    console.log('late output after the deadline');
  }, { timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 504);
  assert.match(result.error, /did not finish within \d+ seconds/);
  assert.match(result.error, /CONSTRUCT_COMMAND_TIMEOUT_SEC/);
  assert.deepEqual(result.output, ['started, then hung'], 'what it printed before the deadline is kept');
  assert.ok(Date.now() - started < 5000);

  // The queue moved on: a second command runs and captures only its own output, even though the first is still
  // "running" and prints late while the second is being captured.
  const next = runCapturing(async () => {
    release();
    await hung;
    await new Promise((r) => setTimeout(r, 10));
    console.log('second command');
  });
  const second = await next;
  assert.equal(second.ok, true);
  assert.deepEqual(second.output, ['second command']);
});

test('the deadline error is its own class, so a route can tell "abandoned" from "failed"', () => {
  const e = new CommandTimeoutError(60_000);
  assert.equal(e.name, 'CommandTimeoutError');
  assert.match(e.message, /60 seconds/);
});
