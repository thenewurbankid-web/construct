// #287 — persistence.
//
// The decision this file exists to defend: process state lives OUTSIDE the
// project. The first test asserts that literally — after a full round trip,
// the project tree must contain nothing the store wrote — because "keep the
// state file in the project, it's simpler" is the change someone will
// propose later, and it is the one that puts runtime state into a user's git
// history.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createProcess, appendLog, startStep } from '../src/engine/processModel.mjs';
import { openProcessStore, resolveStateDir, processDir, projectKey } from '../src/engine/processStore.mjs';

function clock(start = Date.UTC(2026, 8, 20, 10, 0, 0)) {
  let t = start;
  return () => { const at = new Date(t).toISOString(); t += 1000; return at; };
}

const PLAN = {
  version: 1,
  ticket: { source: 'text', title: 'Add totals' },
  steps: [
    { id: 'a', title: 'Create the feature', flow: 'create.feature', args: { name: 'checkout' }, executor: 'deterministic', touches: { features: ['checkout'], files: [] } },
    { id: 'b', title: 'Validate', flow: 'validate', args: {}, executor: 'deterministic', dependsOn: ['a'] },
  ],
};

function setup() {
  const projectRoot = makeTempDir('construct-store-project-');
  const stateDir = makeTempDir('construct-store-state-');
  const now = clock();
  return { projectRoot, stateDir, now, store: openProcessStore(projectRoot, { stateDir, now }) };
}

test('nothing the store writes lands inside the project', () => {
  const { projectRoot, store, now } = setup();
  const before = fs.readdirSync(projectRoot);

  let p = createProcess(PLAN, { id: 'p1', projectRoot, now });
  p = appendLog(p, { provenance: 'ok', message: 'hello', now });
  store.save(p);
  store.save({ ...store.load('p1'), state: 'running.active' });

  assert.deepEqual(fs.readdirSync(projectRoot), before, 'the project tree is untouched — runtime state is machine-local, not source');
  assert.equal(store.dir.startsWith(path.resolve(projectRoot)), false);
  assert.equal(fs.existsSync(path.join(store.dir, 'p1.json')), true);
});

test('the state directory resolves from the environment, CONSTRUCT_STATE_DIR first', () => {
  assert.equal(resolveStateDir({ CONSTRUCT_STATE_DIR: '/var/tmp/x', XDG_STATE_HOME: '/ignored', HOME: '/home/u' }), '/var/tmp/x');
  assert.equal(resolveStateDir({ XDG_STATE_HOME: '/home/u/.state', HOME: '/home/u' }), '/home/u/.state/construct');
  assert.equal(resolveStateDir({ HOME: '/home/u' }), '/home/u/.local/state/construct');
  assert.equal(resolveStateDir({}), path.join(os.homedir(), '.local', 'state', 'construct'));
});

test('two projects with the same basename get different directories, and the name stays readable', () => {
  const a = projectKey('/home/u/work/web');
  const b = projectKey('/home/u/archive/web');
  assert.notEqual(a, b);
  assert.match(a, /^web-[0-9a-f]{12}$/);
  assert.equal(processDir('/home/u/work/web', { stateDir: '/s' }), path.join('/s', 'processes', a));
});

test('a process survives the server being restarted: a brand-new store sees it unchanged', () => {
  const { projectRoot, stateDir, store, now } = setup();
  let p = createProcess(PLAN, { id: 'p1', projectRoot, now });
  p = appendLog(p, { provenance: 'llm', message: 'ollama wrote it', stepId: 'a', now });
  store.save(p);

  const reopened = openProcessStore(projectRoot, { stateDir, now });
  const loaded = reopened.load('p1');
  assert.equal(loaded.id, 'p1');
  assert.deepEqual(loaded.log.map((e) => e.message), ['ollama wrote it']);
  assert.deepEqual(loaded.plan, PLAN, 'including the plan it is running');
  assert.equal(reopened.load('nope'), null);
});

test('list() returns summary rows, newest first', () => {
  const { projectRoot, store, now } = setup();
  store.save(createProcess(PLAN, { id: 'old', projectRoot, now }));
  store.save(createProcess(PLAN, { id: 'new', projectRoot, now }));

  const { processes, problems } = store.list();
  assert.deepEqual(processes.map((p) => p.id), ['new', 'old']);
  assert.deepEqual(problems, []);
  assert.equal('plan' in processes[0], false, 'a listing is summaries, not whole records');
  assert.deepEqual(processes[0].progress, { done: 0, failed: 0, total: 2 });
});

test('a corrupt record is reported, not silently missing, and does not stop the rest listing', () => {
  const { projectRoot, store, now } = setup();
  store.save(createProcess(PLAN, { id: 'good', projectRoot, now }));
  fs.writeFileSync(path.join(store.dir, 'torn.json'), '{"version": 1, "id": "torn"');
  fs.writeFileSync(path.join(store.dir, 'wrong.json'), JSON.stringify({ version: 1, id: 'wrong' }));

  const { processes, problems } = store.list();
  assert.deepEqual(processes.map((p) => p.id), ['good']);
  assert.deepEqual(problems.map((p) => p.id).sort(), ['torn', 'wrong']);
  assert.match(problems.find((p) => p.id === 'torn').reason, /unreadable/);
  assert.match(problems.find((p) => p.id === 'wrong').reason, /invalid: PROCESS_MISSING_FIELD/);

  // Asking for one specific broken process is different: say so loudly.
  assert.throws(() => store.load('torn'), /cannot be read/);
});

test('the store refuses to write a record nothing could read back', () => {
  const { projectRoot, store, now } = setup();
  const p = createProcess(PLAN, { id: 'p1', projectRoot, now });
  assert.throws(() => store.save({ ...p, state: 'melted' }), /Refusing to save an invalid process record/);
  assert.equal(fs.existsSync(path.join(store.dir, 'p1.json')), false);
});

test('a save is atomic: no temp files are left behind', () => {
  const { projectRoot, store, now } = setup();
  store.save(createProcess(PLAN, { id: 'p1', projectRoot, now }));
  store.save({ ...store.load('p1'), state: 'running.active' });
  assert.deepEqual(fs.readdirSync(store.dir), ['p1.json']);
});

test('remove() deletes a record and says whether there was one', () => {
  const { projectRoot, store, now } = setup();
  store.save(createProcess(PLAN, { id: 'p1', projectRoot, now }));
  assert.equal(store.remove('p1'), true);
  assert.equal(store.remove('p1'), false);
  assert.deepEqual(store.list().processes, []);
});

test('a process left running by a killed server is adopted into paused, with the in-flight step back to pending', () => {
  const { projectRoot, store, now } = setup();
  let p = createProcess(PLAN, { id: 'p1', projectRoot, now });
  p = startStep({ ...p, state: 'running.active' }, 'a', { now });
  const saved = store.save(p);
  assert.equal(saved.owner.pid, process.pid, 'a running record records who is running it');

  // Pretend it was another server, long gone.
  fs.writeFileSync(path.join(store.dir, 'p1.json'), JSON.stringify({ ...saved, owner: { pid: 999999, since: saved.owner.since } }));

  const adopted = store.adoptInterrupted({ isAlive: () => false });
  assert.equal(adopted.length, 1);
  assert.equal(adopted[0].state, 'paused', 'a record that says running while nothing is running is a lie; paused is the honest repair');
  assert.equal(adopted[0].currentStepId, null);
  assert.equal(adopted[0].steps.find((s) => s.id === 'a').status, 'pending', 'an interrupted step committed nothing, so re-running it is not a double-apply');
  assert.equal(adopted[0].owner, null);
  assert.equal(adopted[0].log.at(-1).provenance, 'warn');
  assert.match(adopted[0].log.at(-1).message, /Resume to run it again/);
  assert.equal(store.load('p1').state, 'paused', 'and it is persisted, not just returned');
});

test('adoption leaves alone a process whose owner is still alive, and anything not running', () => {
  const { projectRoot, store, now } = setup();
  const running = store.save({ ...createProcess(PLAN, { id: 'live', projectRoot, now }), state: 'running.active' });
  store.save({ ...createProcess(PLAN, { id: 'finished', projectRoot, now }), state: 'done' });
  store.save(createProcess(PLAN, { id: 'queued', projectRoot, now }));

  assert.deepEqual(store.adoptInterrupted({ isAlive: () => true }), [], 'someone else is still driving it');
  assert.equal(store.load('live').state, 'running.active');
  assert.equal(running.owner.pid, process.pid);

  // Our own pid is never adopted, however the liveness check answers.
  assert.deepEqual(store.adoptInterrupted({ pid: process.pid, isAlive: () => false }), []);
  assert.equal(store.load('finished').state, 'done');
  assert.equal(store.load('queued').state, 'queued');
});

test('owner is cleared as soon as a process stops running, so a finished record never looks owned', () => {
  const { projectRoot, store, now } = setup();
  store.save({ ...createProcess(PLAN, { id: 'p1', projectRoot, now }), state: 'running.active' });
  assert.notEqual(store.load('p1').owner, null);
  const done = store.save({ ...store.load('p1'), state: 'done' });
  assert.equal(done.owner, null);
});
