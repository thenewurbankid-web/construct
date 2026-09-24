// #541 -- `review` in the Cockpit's switchable execution mode. The parity CONTRACT: `prHealth(...)` (what the
// Cockpit's review worker calls in `engine` mode) and the real `construct review --format json` subprocess print
// byte-identical JSON for the same throwaway git repository, for every way the Cockpit can ask (no scope, a list of
// feature names, a {features, files} scope, no merge base, a refused ref). On top of that, the production `cli`
// runner (reviewCli.mjs) is compared with the production fork runner on the whole worker-shaped result, and its
// containment and cancellation guarantees are pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { runReview } from '../ui/server/src/coreVerbs.mjs';
import { ExecutionError } from '../ui/server/src/coreExecutor.mjs';
import { cliReviewRunner } from '../ui/server/src/reviewCli.mjs';
import { forkRunner } from '../ui/server/src/reviewRunner.mjs';
import { createReviewExecutor, projectModeOf } from '../ui/server/src/reviewAnalyses.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (dir, msg) => { git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', msg]); };

/** A throwaway repo: the impact-shared fixture on `main`, branch `change` edits it. Returns the dir and both commit ids. */
function makeRepo({ yml = true } = {}) {
  const dir = makeTempDir('construct-review-mode-');
  fs.cpSync(SHARED, dir, { recursive: true });
  if (!yml) fs.rmSync(path.join(dir, 'architecture.yml'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  commit(dir, 'base');
  git(dir, ['checkout', '-q', '-b', 'change']);
  write(dir, 'features/billing/domain/billingRules.ts', '// Pure billing rules: no I/O, no framework.\nexport function totalBilling(lines: number[]): number {\n  return lines.reduce((a, b) => a + b, 0) + 0;\n}\n');
  write(dir, 'features/checkout/domain/checkoutRules.ts', `${fs.readFileSync(path.join(dir, 'features/checkout/domain/checkoutRules.ts'), 'utf8')}// isolated\n`);
  write(dir, 'features/billing/components/badname.tsx', 'export function BadName() { return <span />; }\n');
  commit(dir, 'change');
  git(dir, ['checkout', '-q', 'main']);
  return { dir, base: git(dir, ['rev-parse', 'main']), head: git(dir, ['rev-parse', 'change']) };
}

const REPO_A = makeRepo();

const SCOPES = [
  ['no declared scope', {}],
  ['a list of feature names', { expected: ['billing'] }],
  ['a {features, files} scope', { expected: { features: ['billing'], files: ['features/checkout/domain/checkoutRules.ts'] } }],
  ['no merge base', { mergeBase: false }],
  ['branch names instead of commit ids', { names: true }],
];

for (const [label, extra] of SCOPES) {
  test(`review parity: ${label} -- engine and cli output are byte-identical`, async () => {
    const { dir, base, head } = REPO_A;
    const req = { base: extra.names ? 'main' : base, head: extra.names ? 'change' : head, expected: extra.expected, mergeBase: extra.mergeBase };
    const engine = await runReview(dir, { mode: 'engine', ...req });
    const cli = await runReview(dir, { mode: 'cli', ...req });
    assert.equal(engine.doc.ok, true);
    assert.ok(engine.doc.change.files.length >= 3, 'the change has files, or the comparison is vacuous');
    assert.equal(cli.report, engine.report);
    assert.equal(cli.exitCode, engine.exitCode);
    if (extra.expected) assert.notEqual(engine.doc.request.expected, 'none');
  });
}

test('review parity: a refused ref is the same {ok:false, error} document with the same exit code in both modes', async () => {
  const { dir, head } = REPO_A;
  const req = { base: 'no-such-branch', head };
  const engine = await runReview(dir, { mode: 'engine', ...req });
  const cli = await runReview(dir, { mode: 'cli', ...req });
  assert.equal(engine.doc.ok, false);
  assert.equal(cli.report, engine.report);
  assert.equal(cli.exitCode, engine.exitCode);
  assert.notEqual(cli.exitCode, 0);
});

test('review: the executor prints what the CLI printed (its own stdout), and refuses a ref that could be a flag', async () => {
  const { dir, base, head } = REPO_A;
  const engine = await runReview(dir, { mode: 'engine', base, head });
  const out = spawnSync(process.execPath, [CLI, 'review', base, head, '--format', 'json', '--dir', dir], { encoding: 'utf8' });
  assert.equal(out.stdout, `${engine.report}\n`);
  for (const bad of ['--output=x', '-x', '', 'a b', 1]) {
    await assert.rejects(runReview(dir, { mode: 'cli', base: bad, head }), (e) => e instanceof ExecutionError && e.code === 'CLI_START_FAILED');
  }
});

// ---- the production runners ---------------------------------------------------------------------------------

test('cliReviewRunner gives the same worker-shaped result as the fork runner (report, changed-file units), and says it ran via the cli', async () => {
  const { dir, base, head } = REPO_A;
  const job = { root: fs.realpathSync(dir), baseSha: base, headSha: head, expected: { features: ['billing'], files: [] } };
  const forked = await forkRunner(job, { timeoutMs: 60_000 });
  const viaCli = await cliReviewRunner(job, { timeoutMs: 60_000 });
  assert.equal(forked.ok, true);
  assert.equal(viaCli.ok, true);
  assert.equal(JSON.stringify(viaCli.report), JSON.stringify(forked.report));
  assert.ok(forked.units.length > 0, 'units are part of the result the Cockpit shows');
  assert.equal(JSON.stringify(viaCli.units), JSON.stringify(forked.units));
  assert.equal(viaCli.unitsOmitted, forked.unitsOmitted);
  assert.equal(viaCli.worker.via, 'cli');
});

test('cliReviewRunner: a refused ref comes back as the CLI\'s own error, in the worker\'s {ok:false, error} shape', async () => {
  const { dir, head } = REPO_A;
  const forked = await forkRunner({ root: fs.realpathSync(dir), baseSha: 'f'.repeat(40), headSha: head }, { timeoutMs: 60_000 });
  const viaCli = await cliReviewRunner({ root: fs.realpathSync(dir), baseSha: 'f'.repeat(40), headSha: head }, { timeoutMs: 60_000 });
  assert.equal(forked.ok, false);
  assert.deepEqual(viaCli, forked);
});

test('cliReviewRunner refuses a root that is not its own architecture.yml directory: the CLI would climb out of it', async () => {
  const repo = makeRepo({ yml: false });
  const runs = [];
  const r = await cliReviewRunner({ root: fs.realpathSync(repo.dir), baseSha: repo.base, headSha: repo.head }, { cli: { spawnImpl: (...a) => { runs.push(a); throw new Error('must not spawn'); } } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CLI_ROOT_MISMATCH');
  assert.equal(runs.length, 0);
});

test('cliReviewRunner: an abort stops the CLI\'s whole process group, reclaims by its pid, and reports CANCELLED; a timeout says TIMEOUT', async () => {
  const { dir, base, head } = REPO_A;
  const sleeper = path.join(makeTempDir('construct-review-bin-'), 'sleep.mjs');
  fs.writeFileSync(sleeper, 'setInterval(() => {}, 1000);');
  const reclaimed = [];
  const ctrl = new AbortController();
  const p = cliReviewRunner({ root: fs.realpathSync(dir), baseSha: base, headSha: head }, { signal: ctrl.signal, graceMs: 300, timeoutMs: 30_000, reclaim: (pid, root) => reclaimed.push([pid, root]), cli: { bin: sleeper } });
  setTimeout(() => ctrl.abort(), 300);
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CANCELLED');
  assert.equal(reclaimed.length, 1);
  assert.equal(typeof reclaimed[0][0], 'number');
  const t = await cliReviewRunner({ root: fs.realpathSync(dir), baseSha: base, headSha: head }, { timeoutMs: 400, graceMs: 200, reclaim: () => {}, cli: { bin: sleeper } });
  assert.equal(t.error.code, 'TIMEOUT');
  const gone = await cliReviewRunner({ root: fs.realpathSync(dir), baseSha: base, headSha: head }, { signal: AbortSignal.abort(), cli: { bin: sleeper } });
  assert.equal(gone.error.code, 'CANCELLED');
});

// ---- the Review analysis step picks its runner from the project's mode ---------------------------------------

test('createReviewExecutor: project.execution.mode picks the runner; an unknown mode fails the step with the config\'s message', async () => {
  const seen = [];
  const ok = (which) => async () => { seen.push(which); return { ok: false, error: { code: 'X', message: which } }; };
  const { dir, base, head } = REPO_A;
  const step = { id: 'analyse', flow: 'review.analyze', args: { base, head } };
  const ctx = { process: { id: 'p', projectRoot: dir }, step, signal: new AbortController().signal, log: () => {} };
  for (const mode of ['engine', 'cli']) {
    const exec = createReviewExecutor({ run: ok('fork'), runCli: ok('cli'), modeOf: () => mode });
    await exec.executeStep(ctx);
  }
  assert.deepEqual(seen, ['fork', 'cli']);
  const cfg = makeTempDir('construct-review-mode-cfg-');
  fs.writeFileSync(path.join(cfg, 'architecture.yml'), 'project:\n  execution:\n    mode: bogus\n');
  assert.throws(() => projectModeOf(cfg), /Unknown project\.execution\.mode 'bogus'/);
  fs.writeFileSync(path.join(cfg, 'architecture.yml'), 'project:\n  execution:\n    mode: cli\n');
  assert.equal(projectModeOf(cfg), 'cli');
  const failing = createReviewExecutor({ run: ok('fork'), runCli: ok('cli'), modeOf: () => { throw new Error('Unknown project.execution.mode \'bogus\''); } });
  const r = await failing.executeStep(ctx);
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown project\.execution\.mode/);
});
