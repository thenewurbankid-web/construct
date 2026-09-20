// #291 — the bot runner, proven against a real git repository and real child
// processes (the child is a stand-in for bin/construct.mjs, see
// test-utils/fakeConstructBin.mjs). What is worth failing a build over:
//  1. bots write only in their worktree — the user's tree is byte-identical
//     after success, failure and cancel;
//  2. a failed step stops the plan and keeps the steps that already committed;
//  3. a dead owner's worktree is reclaimed, a live or unparseable one is not;
//  4. a `user` step pauses the process;
//  5. every step records whether a model was involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { PLAN_FLOWS } from '../src/plan.mjs';
import { createProcess } from '../src/engine/processModel.mjs';
import { openProcessStore } from '../src/engine/processStore.mjs';
import { createProcessEngine } from '../src/engine/processEngine.mjs';
import { createBotRunner, botBranch, resolveMaxConcurrent } from '../src/engine/botRunner.mjs';

const FAKE_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-utils', 'fakeConstructBin.mjs');
const run = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim();
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);

/** sha256 of every file (except .git) — "byte-identical" made checkable. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(root);
  return out;
}

const step = (id, name, extra = {}) => ({
  id,
  title: `Scaffold ${name}`,
  flow: 'create.unit',
  args: { layer: 'domain', name, feature: 'checkout' },
  executor: 'deterministic',
  touches: { features: ['checkout'], files: [{ path: `features/checkout/domain/${name}.ts`, change: 'create' }] },
  ...extra,
});
const featureStep = {
  id: 'feature',
  title: 'Create checkout',
  flow: 'create.feature',
  args: { name: 'checkout' },
  executor: 'deterministic',
  touches: { features: ['checkout'], files: [{ path: 'features/checkout/index.ts', change: 'create' }] },
};
const plan = (...steps) => ({ version: 1, ticket: { source: 'text', title: 'Checkout' }, steps });

function harness(p, { maxConcurrent, env } = {}) {
  const projectRoot = makeTempDir('construct-bot-project-');
  const stateDir = makeTempDir('construct-bot-state-');
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'user work\n');
  run(projectRoot, 'init', '-q', '-b', 'main');
  run(projectRoot, 'add', '-A');
  run(projectRoot, ...ID, 'commit', '-q', '-m', 'readme');
  const store = openProcessStore(projectRoot, { stateDir });
  const record = store.save(createProcess(p, { id: 'p1', projectRoot }));
  const runner = createBotRunner({ stateDir, bin: FAKE_BIN, maxConcurrent, env: { ...process.env, ...env } });
  const engine = createProcessEngine({ store, executeStep: runner.executeStep, maxConcurrent: runner.maxConcurrent, validate: () => ({ violations: [], ok: true }) });
  return { projectRoot, stateDir, store, record, runner, engine, before: snapshot(projectRoot) };
}

test('a plan runs in the bot worktree: each step is a commit, artifacts stay unapproved, the user tree is byte-identical', async () => {
  const h = harness(plan(featureStep, step('domain', 'Total', { dependsOn: ['feature'] })));
  h.engine.start('p1');
  const done = await h.engine.settled('p1');

  assert.equal(done.state, 'done');
  assert.deepEqual(done.artifacts.map((a) => a.path).sort(), ['features/checkout/domain/Total.ts', 'features/checkout/index.ts']);
  assert.equal(done.artifacts.every((a) => a.approved === null && a.change === 'create'), true);
  assert.deepEqual(snapshot(h.projectRoot), h.before, 'the user tree must not change until the approval gate');
  assert.equal(run(h.projectRoot, 'status', '--porcelain'), '');

  const log = run(h.projectRoot, 'log', '--format=%s', botBranch('p1')).split('\n');
  assert.deepEqual(log.slice(0, 2), ['domain: Scaffold Total', 'feature: Create checkout']);
  assert.equal(h.runner.worktreeOf('p1').startsWith(h.stateDir), true, 'the worktree lives outside the project');
});

test('a failed step stops the plan, keeps committed steps, discards the half-written file and leaves the user tree alone', async () => {
  const h = harness(plan(featureStep, step('boom', 'Boom', { dependsOn: ['feature'] }), step('after', 'After', { dependsOn: ['boom'] })));
  h.engine.start('p1');
  const stopped = await h.engine.settled('p1');

  assert.equal(stopped.state.split('.')[0], 'failed');
  assert.deepEqual(stopped.steps.map((s) => s.status), ['done', 'failed', 'skipped']);
  assert.match(stopped.steps[1].error, /exited with status 3.*could not scaffold/s);
  assert.deepEqual(stopped.artifacts.map((a) => a.path), ['features/checkout/index.ts'], 'the committed step is kept');
  const wt = h.runner.worktreeOf('p1');
  assert.equal(fs.existsSync(path.join(wt, 'features/checkout/domain/Boom.ts')), false, 'half-written output is reset');
  assert.equal(run(wt, 'status', '--porcelain'), '');
  assert.deepEqual(snapshot(h.projectRoot), h.before);
});

test('cancel mid-step kills the child, resets the worktree and leaves the user tree untouched', async () => {
  const h = harness(plan(featureStep, step('hang', 'Hang', { dependsOn: ['feature'] })));
  h.engine.start('p1');
  const hung = () => { const wt = h.runner.worktreeOf('p1'); return wt && path.join(wt, 'features/checkout/domain/Hang.ts'); };
  for (let i = 0; i < 100 && !(hung() && fs.existsSync(hung())); i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(hung()), true, 'step is genuinely in flight');
  h.engine.cancel('p1');
  const final = await h.engine.settled('p1');

  assert.equal(final.state.split('.')[0], 'cancelled');
  assert.equal(fs.existsSync(hung()), false);
  assert.deepEqual(snapshot(h.projectRoot), h.before);
  assert.equal(run(h.projectRoot, 'log', '--format=%s', botBranch('p1')).split('\n')[0], 'feature: Create checkout', 'the committed step survives a cancel');
});

test('a user step pauses the process instead of running', async () => {
  const flowId = Object.keys(PLAN_FLOWS).find((k) => PLAN_FLOWS[k].cli === null);
  assert.ok(flowId, 'the registry has a manual flow');
  const userStep = { id: 'manual', title: 'Review the design', flow: flowId, args: { instructions: 'look at it' }, touches: { features: [], files: [] }, executor: 'user', dependsOn: ['feature'] };
  const h = harness(plan(featureStep, userStep));
  h.engine.start('p1');
  const paused = await h.engine.settled('p1');
  assert.equal(paused.state.startsWith('paused'), true, `got ${paused.state}`);
  assert.equal(paused.steps.find((s) => s.id === 'manual').status, 'awaiting-user');
  assert.equal(paused.steps[0].status, 'done');
});

test('provenance: deterministic steps report no model and see none; local-model steps report their provider', async () => {
  const modelStep = step('fill', 'Fill', { executor: 'local-model', args: { layer: 'service', name: 'Fill', feature: 'checkout', llm: 'ollama' }, dependsOn: ['feature'] });
  const h = harness(plan(featureStep, modelStep, step('det', 'Det', { dependsOn: ['fill'] })), { env: { OLLAMA_HOST: 'http://localhost:1' } });
  h.engine.start('p1');
  const done = await h.engine.settled('p1');
  assert.equal(done.state, 'done');
  assert.deepEqual(done.steps.map((s) => s.llm && s.llm.provider), [null, 'ollama', null]);
  const wt = h.runner.worktreeOf('p1');
  assert.match(fs.readFileSync(path.join(wt, 'features/checkout/domain/Det.ts'), 'utf8'), /no-model-env/, 'no model environment reaches a deterministic step');
  assert.match(fs.readFileSync(path.join(wt, 'features/checkout/service/Fill.ts'), 'utf8'), /llm=ollama MODEL-ENV/);
});

test('a deterministic step that asks for a model is refused', async () => {
  const bad = step('bad', 'Bad', { args: { layer: 'domain', name: 'Bad', feature: 'checkout', llm: 'claude' } });
  const h = harness(plan(featureStep));
  const result = await h.runner.executeStep({
    process: h.record, step: bad, command: { argv: ['create'], stdin: null, files: [], manual: false }, signal: new AbortController().signal, log() {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.llm, null);
  assert.match(result.error, /deterministic but asks for a model/);
});

test('dead-worktree reclaim: dead owner removed; live, unparseable and own left alone', () => {
  const h = harness(plan(featureStep));
  const root = h.runner.worktreeRoot;
  fs.mkdirSync(root, { recursive: true });
  const dead = deadPid();
  const mk = (name) => { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'f'), 'x'); };
  mk(`${dead}-p9`);
  mk(`${process.ppid}-p8`); // a live pid that is not ours
  mk('garbage-p7');
  mk(`${process.pid}-p6`);
  assert.deepEqual(h.runner.reclaimDead(), [`${dead}-p9`]);
  assert.deepEqual(fs.readdirSync(root).sort(), [`${process.pid}-p6`, `${process.ppid}-p8`, 'garbage-p7'].sort());
});

test('a killed server: the dead pid\'s worktree is reclaimed from git too, and the branch with its committed steps is kept', async () => {
  const h = harness(plan(featureStep, step('domain', 'Total', { dependsOn: ['feature'] })));
  h.engine.start('p1');
  await h.engine.settled('p1');
  const dead = deadPid();
  const deadDir = path.join(h.runner.worktreeRoot, `${dead}-p1`);
  run(h.projectRoot, 'worktree', 'move', h.runner.worktreeOf('p1'), deadDir); // as if the owner had been that pid
  fs.writeFileSync(`${deadDir}.json`, JSON.stringify({ repo: fs.realpathSync(h.projectRoot) }));

  const fresh = createBotRunner({ stateDir: h.stateDir, bin: FAKE_BIN });
  assert.deepEqual(fresh.reclaimDead(), [`${dead}-p1`]);
  assert.equal(fs.existsSync(deadDir), false);
  assert.equal(run(h.projectRoot, 'worktree', 'list').includes(`${dead}-p1`), false, 'git no longer lists the reclaimed worktree');
  assert.equal(run(h.projectRoot, 'rev-parse', '--verify', botBranch('p1')).length > 0, true, 'the branch (committed steps) is kept');
});

test('release removes the worktree directory but keeps the branch', async () => {
  const h = harness(plan(featureStep));
  h.engine.start('p1');
  await h.engine.settled('p1');
  const dir = h.runner.worktreeOf('p1');
  assert.equal(h.runner.release('p1'), true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(run(h.projectRoot, 'log', '--format=%s', botBranch('p1')).split('\n')[0], 'feature: Create checkout');
});

test('concurrency defaults low and is configurable', () => {
  assert.equal(resolveMaxConcurrent(undefined, {}), 1);
  assert.equal(resolveMaxConcurrent(undefined, { CONSTRUCT_BOT_CONCURRENCY: '3' }), 3);
  assert.equal(resolveMaxConcurrent(2, { CONSTRUCT_BOT_CONCURRENCY: '3' }), 2);
  assert.equal(resolveMaxConcurrent('0', {}), 1);
  assert.equal(resolveMaxConcurrent('nope', {}), 1);
});
