// #612: `GET /api/validate` in `cli` execution mode runs its subprocess inside the per-login command queue and the
// global concurrency cap (commandRunner.mjs runCapturing), like every other cli-mode verb (coreVerbs.mjs
// cliCommandResult). Before, the subprocess was spawned outside the queue, so a validate could overlap a write to
// the same project and was not counted against the cap. Engine mode is unchanged (in-process, not queued).
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { handleValidateForProject } from './validateApi.mjs';
import { runCapturing, runningCommandCount } from './commandRunner.mjs';
import { createLogBuffer } from './logBuffer.mjs';
import { baseWorkspaceRoot, resetWorkspaceRootForTests, runInUserWorkspace } from './workspace.mjs';

let tmp;
let saved;

before(() => {
  tmp = makeTempDir('construct-validate-queue-');
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
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const base = { origin: 'http://localhost:3000', clientOrigin: 'http://localhost:3000' };

function gate() {
  let open;
  const opened = new Promise((r) => { open = r; });
  return { opened, open };
}

function cliProject() {
  const dir = makeTempDir('construct-validate-queue-proj-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'project:\n  execution:\n    mode: cli\n');
  return dir;
}

const validateWith = (dir, execute, extra = {}) => handleValidateForProject({ ...base, projectDir: dir, findRoot: () => dir, log: createLogBuffer(), execute, ...extra });

test('cli mode: a validate waits for an earlier command of the same login instead of overlapping it', async () => {
  const dir = cliProject();
  const events = [];
  const hold = gate();
  const result = await as('vera', async () => {
    const write = runCapturing(async () => { events.push('write start'); await hold.opened; events.push('write end'); });
    const validate = validateWith(dir, async () => { events.push('validate start'); return { ok: true, violations: [] }; });
    await tick(50);
    assert.deepEqual(events, ['write start'], 'the validate has not spawned beside the running write');
    hold.open();
    const [, r] = await Promise.all([write, validate]);
    return r;
  });
  assert.deepEqual(events, ['write start', 'write end', 'validate start']);
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'cli');
  assert.equal(result.body.passed, true);
  assert.equal(runningCommandCount(), 0, 'the run slot is released');
});

test('cli mode: a validate counts against the global concurrency cap', async () => {
  const dir = cliProject();
  const holdA = gate();
  const holdB = gate();
  const held = [
    as('wes', () => runCapturing(() => holdA.opened)),
    as('xena', () => runCapturing(() => holdB.opened)),
  ];
  await tick(30);
  assert.equal(runningCommandCount(), 2, 'the default cap of 2 is full');
  let started = false;
  const validate = as('yuri', () => validateWith(dir, async () => { started = true; return { ok: true, violations: [] }; }));
  await tick(50);
  assert.equal(started, false, 'no free run slot: the validate has not started');
  holdA.open();
  const r = await validate;
  assert.equal(started, true);
  assert.equal(r.status, 200);
  holdB.open();
  await Promise.all(held);
  assert.equal(runningCommandCount(), 0);
});

test('cli mode: the CLI failure and the generic failure keep their statuses through the queue', async () => {
  const dir = cliProject();
  const { ExecutionError } = await import('./coreExecutor.mjs');
  const cliFailed = await validateWith(dir, async () => { throw new ExecutionError('CLI_FAILED', 'The construct CLI exited with code 2: boom'); });
  assert.equal(cliFailed.status, 502);
  assert.match(cliFailed.body.error, /exited with code 2: boom/);
  const other = await validateWith(dir, async () => { throw new Error('/secret/path'); });
  assert.equal(other.status, 500);
  assert.equal(other.body.error, 'Validation could not run.');
  assert.equal(runningCommandCount(), 0);
});

test('cli mode: a validate abandoned at the command deadline answers 504 and frees the queue', async () => {
  const dir = cliProject();
  const prev = process.env.CONSTRUCT_COMMAND_TIMEOUT_SEC;
  process.env.CONSTRUCT_COMMAND_TIMEOUT_SEC = '0.1';
  try {
    const r = await validateWith(dir, () => new Promise(() => {}));
    assert.equal(r.status, 504);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.mode, 'cli');
    assert.match(r.body.error, /did not finish/);
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_COMMAND_TIMEOUT_SEC;
    else process.env.CONSTRUCT_COMMAND_TIMEOUT_SEC = prev;
  }
  assert.equal(runningCommandCount(), 0);
});
