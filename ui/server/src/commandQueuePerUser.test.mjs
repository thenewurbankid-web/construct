// #569 slice 4: the command queue is per signed-in login, with a global cap on how many commands run at once.
// Two users in one server process never wait for each other's commands; one user's own commands still run one
// at a time in order; the cap bounds the machine no matter how many users are signed in; captured output and the
// exit code stay per command even while commands run side by side; no session / auth off keeps behaving exactly
// as the old single queue did (key '').
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { runCapturing, runningCommandCount, resolveMaxConcurrentCommands, DEFAULT_MAX_CONCURRENT_COMMANDS } from './commandRunner.mjs';
import { EXIT_CODES, setExitCode } from '../../../packages/core/diagnostics.mjs';
import { baseWorkspaceRoot, resetWorkspaceRootForTests, runInUserWorkspace, currentLogin } from './workspace.mjs';

let tmp;
let saved;

before(() => {
  tmp = makeTempDir('construct-command-queue-users-');
  const base = path.join(fs.realpathSync.native(tmp), 'ws');
  fs.mkdirSync(base);
  saved = process.env.CONSTRUCT_WORKSPACE_ROOT;
  process.env.CONSTRUCT_WORKSPACE_ROOT = base;
  resetWorkspaceRootForTests();
  baseWorkspaceRoot();
});

after(() => {
  if (saved === undefined) delete process.env.CONSTRUCT_WORKSPACE_ROOT;
  else process.env.CONSTRUCT_WORKSPACE_ROOT = saved;
  resetWorkspaceRootForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const as = (login, fn) => runInUserWorkspace(login, fn);

/** A manually released promise, plus whether anyone is waiting on it yet. */
function gate() {
  let open;
  const opened = new Promise((r) => { open = r; });
  return { opened, open };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Poll `cond` for up to `ms`, so timing-based assertions never depend on one scheduler slice. */
async function until(cond, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return false;
    await tick(5);
  }
  return true;
}

test('resolveMaxConcurrentCommands: CONSTRUCT_MAX_CONCURRENT_COMMANDS, default 2, nonsense ignored', () => {
  assert.equal(DEFAULT_MAX_CONCURRENT_COMMANDS, 2);
  assert.equal(resolveMaxConcurrentCommands({}), 2);
  assert.equal(resolveMaxConcurrentCommands({ CONSTRUCT_MAX_CONCURRENT_COMMANDS: '4' }), 4);
  for (const bad of ['0', '-1', '1.5', 'x', '']) assert.equal(resolveMaxConcurrentCommands({ CONSTRUCT_MAX_CONCURRENT_COMMANDS: bad }), 2);
});

test('A\'s long command does not delay B\'s: B finishes while A is still running', async () => {
  const hold = gate();
  let aStarted = false;
  const a = as('alice', () => runCapturing(async () => { aStarted = true; console.log('alice working'); await hold.opened; console.log('alice done'); }));
  assert.ok(await until(() => aStarted), 'alice started');

  const b = await as('bob', () => runCapturing(async () => { console.log('bob quick'); }));
  assert.equal(b.ok, true);
  assert.deepEqual(b.output, ['bob quick']);
  assert.equal(runningCommandCount(), 1, 'alice still holds her slot while bob is already done');

  hold.open();
  const aResult = await a;
  assert.deepEqual(aResult.output, ['alice working', 'alice done']);
  assert.equal(runningCommandCount(), 0);
});

test('within one login, commands stay serialized in the order they were sent', async () => {
  const hold = gate();
  const order = [];
  const first = as('carol', () => runCapturing(async () => { order.push('first:start'); await hold.opened; order.push('first:end'); }));
  const second = as('carol', () => runCapturing(async () => { order.push('second:start'); }));
  assert.ok(await until(() => order.includes('first:start')));
  await tick(30);
  assert.deepEqual(order, ['first:start'], 'the second command has not started while the first is running');

  hold.open();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
});

test('the command runs under the login that sent it, even when it starts later on the chain', async () => {
  const hold = gate();
  const seen = [];
  const first = as('dan', () => runCapturing(async () => { await hold.opened; seen.push(currentLogin()); }));
  const second = as('dan', () => runCapturing(async () => { seen.push(currentLogin()); }));
  const other = as('erin', () => runCapturing(async () => { seen.push(currentLogin()); }));
  await other;
  hold.open();
  await Promise.all([first, second]);
  assert.deepEqual(seen, ['erin', 'dan', 'dan']);
});

test('the global cap is honoured: with cap 2, a third login\'s command waits for a free slot (FIFO)', async () => {
  const holdA = gate();
  const holdB = gate();
  const started = [];
  const a = as('fay', () => runCapturing(async () => { started.push('fay'); await holdA.opened; }, { maxConcurrent: 2 }));
  const b = as('gus', () => runCapturing(async () => { started.push('gus'); await holdB.opened; }, { maxConcurrent: 2 }));
  assert.ok(await until(() => started.length === 2));
  assert.equal(runningCommandCount(), 2);

  const c = as('hal', () => runCapturing(async () => { started.push('hal'); }, { maxConcurrent: 2 }));
  await tick(30);
  assert.deepEqual(started, ['fay', 'gus'], 'hal waits while both slots are taken');
  assert.equal(runningCommandCount(), 2);

  holdA.open();
  await a;
  assert.ok(await until(() => started.includes('hal')), 'hal starts as soon as a slot frees');
  await c;
  holdB.open();
  await b;
  assert.equal(runningCommandCount(), 0);
});

test('a command that hits its deadline releases its slot, so the waiting command starts', async () => {
  const never = gate();
  const started = [];
  const stuck = as('ivy', () => runCapturing(async () => { started.push('ivy'); await never.opened; }, { maxConcurrent: 1, timeoutMs: 50 }));
  const next = as('jon', () => runCapturing(async () => { started.push('jon'); }, { maxConcurrent: 1 }));
  const stuckResult = await stuck;
  assert.equal(stuckResult.httpStatus, 504);
  const nextResult = await next;
  assert.equal(nextResult.ok, true);
  assert.deepEqual(started, ['ivy', 'jon']);
  assert.equal(runningCommandCount(), 0);
  never.open();
});

test('captured output never interleaves across logins running at the same time', async () => {
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  const stepA = gate();
  const stepB = gate();
  const a = as('kim', () => runCapturing(async () => {
    console.log('kim 1');
    stepB.open();
    await stepA.opened;
    console.warn('kim 2');
    console.error('kim 3');
  }));
  const b = as('lee', () => runCapturing(async () => {
    await stepB.opened;
    console.log('lee 1');
    console.error('lee 2');
    stepA.open();
    await tick(10);
    console.log('lee 3');
  }));
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(ra.output, ['kim 1', 'kim 2', 'kim 3']);
  assert.deepEqual(rb.output, ['lee 1', 'lee 2', 'lee 3']);
  // One shared patch for the overlap, restored exactly once the last concurrent capture ended: the real console
  // is back, not a leftover patch from whichever command finished last.
  assert.equal(console.log, realConsole.log);
  assert.equal(console.warn, realConsole.warn);
  assert.equal(console.error, realConsole.error);
});

test('the exit code is per command while commands overlap; process.exitCode is never touched', async () => {
  const priorExit = process.exitCode;
  const sync = gate();
  const a = as('mia', () => runCapturing(async () => { setExitCode(EXIT_CODES.USAGE_ERROR); await sync.opened; }));
  const b = as('ned', () => runCapturing(async () => { await tick(5); /* sets nothing */ }));
  const c = as('ola', () => runCapturing(async () => { await tick(5); setExitCode(EXIT_CODES.INTERNAL_ERROR); sync.open(); }, { maxConcurrent: 3 }));
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(ra.httpStatus, 400, 'mia: USAGE_ERROR -> 400');
  assert.equal(rb.httpStatus, 200, 'ned: nothing set -> 200, not mia\'s or ola\'s code');
  assert.equal(rc.httpStatus, 500, 'ola: INTERNAL_ERROR -> 500');
  assert.equal(process.exitCode, priorExit);
});

test('a single-user / no-session setup (auth off) behaves exactly as before: one serialized queue, key \'\'', async () => {
  assert.equal(currentLogin(), '');
  const hold = gate();
  const order = [];
  const first = runCapturing(async () => { order.push('first:start'); await hold.opened; order.push('first:end'); });
  const second = runCapturing(async () => { order.push('second:start'); });
  assert.ok(await until(() => order.includes('first:start')));
  await tick(30);
  assert.deepEqual(order, ['first:start']);
  // A signed-in login is not held up by the no-session chain.
  const other = await as('pat', () => runCapturing(async () => { console.log('pat'); }));
  assert.deepEqual(other.output, ['pat']);
  hold.open();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
});
