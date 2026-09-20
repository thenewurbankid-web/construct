// #312/#313 -- the Review API. Security first (every route behind the session gate; a client-supplied
// ref is refused unless it is exactly a branch of THIS project; nothing is ever read from a client path),
// then behaviour, then the read-only guarantee measured on a real throwaway repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createReviewRouter } from './reviewApi.mjs';
import os from 'node:os';
import { createReviewJobs } from './reviewJobs.mjs';
import { createReviewExecutor, createAnalyses, composeExecutors, createResults, isAnalysisPlan } from './reviewAnalyses.mjs';
import { createProcessesService } from './processesService.mjs';
import { forkRunner } from './reviewRunner.mjs';
import { createPlanSource } from './reviewPlans.mjs';
import { listLocalBranches, resolveListed, defaultBase } from './reviewRefs.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');
const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;

const run = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (dir, msg) => { run(dir, ['add', '-A']); run(dir, ['commit', '-q', '-m', msg]); };

/** impact-shared on `main`; `change` edits billing + checkout; `docs` only touches the README. */
function makeRepo() {
  const dir = makeTempDir('construct-review-');
  fs.cpSync(SHARED, dir, { recursive: true });
  run(dir, ['init', '-q', '-b', 'main']);
  run(dir, ['config', 'user.email', 't@example.com']);
  run(dir, ['config', 'user.name', 'T']);
  run(dir, ['config', 'commit.gpgsign', 'false']);
  commit(dir, 'base');
  run(dir, ['checkout', '-q', '-b', 'change']);
  write(dir, 'features/billing/domain/billingRules.ts', '// Pure billing rules: no I/O, no framework.\nexport function totalBilling(lines: number[]): number {\n  return lines.reduce((a, b) => a + b, 0) + 0;\n}\n');
  write(dir, 'features/checkout/domain/checkoutRules.ts', `${fs.readFileSync(path.join(dir, 'features/checkout/domain/checkoutRules.ts'), 'utf8')}// isolated\n`);
  commit(dir, 'change billing and checkout');
  run(dir, ['checkout', '-q', 'main']);
  run(dir, ['checkout', '-q', '-b', 'docs']);
  write(dir, 'README.md', '# shop\nmore words\n');
  commit(dir, 'docs');
  run(dir, ['checkout', '-q', 'main']);
  return dir;
}

const snapshot = (dir) => ({
  head: run(dir, ['rev-parse', 'HEAD']),
  branch: run(dir, ['symbolic-ref', '-q', 'HEAD']),
  refs: run(dir, ['for-each-ref', '--format=%(refname) %(objectname)']),
  worktrees: run(dir, ['worktree', 'list', '--porcelain']),
  status: run(dir, ['status', '--porcelain=v2', '--untracked-files=all']),
  stash: run(dir, ['stash', 'list']),
});

// Two saved plans as the process store would hold them (a process stores its plan verbatim).
const planRecord = (id, title, touches) => ({ id, title, state: 'succeeded', plan: { steps: [{ id: 's1', touches }] } });
const RECORDS = [
  planRecord('proc-billing', 'Billing only', { features: ['billing'], files: [{ path: 'features/billing/domain/billingRules.ts', change: 'modify' }] }),
  planRecord('proc-all', 'Billing and checkout', { features: ['billing', 'checkout'], files: [] }),
];

async function withStack({ authOn = true, repo = makeRepo(), runner, records = RECORDS, runOptions } = {}, fn) {
  // The real wiring of index.mjs, with a private state directory: every analysis is a Process in a real
  // store, driven by the real engine, executed by the read-only review executor (never the bot runner).
  const results = createResults();
  const reviewExecutor = createReviewExecutor({ ...(runner ? { run: runner } : {}), ...(runOptions ? { runOptions } : {}), results });
  const botRefused = async () => ({ ok: false, llm: null, error: 'a bot step must not run in this test' });
  const service = createProcessesService({
    getProjectDir: () => repo,
    stateDir: makeTempDir('og351-state-'),
    executeStep: composeExecutors({ bot: botRefused, review: reviewExecutor.executeStep }),
  });
  const jobs = createReviewJobs({ analyses: createAnalyses({ service, results }) });
  const auth = createAuth(resolveAuthConfig(authOn ? ENV : {}, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/review', createReviewRouter({ jobs, clientOrigin: ORIGIN, plans: createPlanSource({ records: () => records }), getRoot: () => (repo ? { ok: true, root: repo } : { ok: false, error: 'No Construct project found for the current project directory. Pick a project first.' }) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, cookie: cookie(), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (method, p, opts) => { const r = await call(method, p, opts); return { status: r.status, body: await r.json() }; };
  try {
    await fn({ repo, jobs, call, json, port, service });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

async function until(fn, what) {
  for (let i = 0; i < 1500; i += 1) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// --- security --------------------------------------------------------------

test('every /api/review route is refused with 401 when there is no session', async () => {
  await withStack({}, async ({ call }) => {
    for (const [method, p, body] of [
      ['GET', '/api/review/branches'],
      ['GET', '/api/review/change?base=main&head=change'],
      ['POST', '/api/review/analyze', { base: 'main', heads: ['change'] }],
      ['POST', '/api/review/cancel', { base: 'main', head: 'change' }],
      ['GET', '/api/review/plans'],
    ]) {
      const res = await call(method, p, { body, headers: { cookie: '' } });
      assert.equal(res.status, 401, `${method} ${p} must need a session`);
    }
    assert.equal((await call('GET', '/api/review/branches')).status, 200);
  });
});

test('the real server registers /api/review AFTER the session gate', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const review = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/review'));
  assert.ok(gate >= 0, 'the session gate is in the route table');
  assert.ok(review > gate, 'the review router must come after the gate');
});

const BAD_REFS = [
  ['an option', '--output=/tmp/og312-pwned'],
  ['a short option', '-x'],
  ['a path', '/etc/passwd'],
  ['a relative path', '../../etc/passwd'],
  ['dot-dot', '..'],
  ['a range', 'main..change'],
  ['a revision expression', 'change^'],
  ['a branch that does not exist', 'nope'],
  ['a raw sha', 'a'.repeat(40)],
  ['an empty name', ''],
  ['a name with a newline', 'change\nmain'],
];

test('a ref that is not exactly a listed branch is refused, on every endpoint, and starts no work', async () => {
  const marker = '/tmp/og312-pwned';
  fs.rmSync(marker, { force: true });
  await withStack({}, async ({ json, jobs }) => {
    for (const [label, ref] of BAD_REFS) {
      const q = `base=${encodeURIComponent(ref)}&head=change`;
      const badBase = await json('GET', `/api/review/change?${q}`);
      assert.ok([400, 404].includes(badBase.status), `${label} as base: got ${badBase.status}`);
      assert.equal(badBase.body.ok, false);
      const badHead = await json('GET', `/api/review/change?base=main&head=${encodeURIComponent(ref)}`);
      assert.ok([400, 404].includes(badHead.status), `${label} as head: got ${badHead.status}`);
      const list = await json('GET', `/api/review/branches?base=${encodeURIComponent(ref)}`);
      assert.ok(list.status === 400 || list.status === 404 || (ref === '' && list.status === 200), `${label} as list base: got ${list.status}`);
      const post = await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change', ref] } });
      assert.ok([400, 404].includes(post.status), `${label} in heads: got ${post.status}`);
      const post2 = await json('POST', '/api/review/analyze', { body: { base: ref, heads: ['change'] } });
      assert.ok([400, 404].includes(post2.status), `${label} as analyze base: got ${post2.status}`);
    }
    assert.equal(jobs.pending(), 0, 'a refused request must not have started any analysis');
  });
  assert.equal(fs.existsSync(marker), false, 'an option-shaped ref must never reach git');
});

test('a ref beginning with "-" is refused explicitly with 400', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('GET', '/api/review/change?base=main&head=--upload-pack%3Dtouch%20x');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /cannot start with "-"/);
  });
});

test('the repository is never taken from the client: extra path parameters are ignored', async () => {
  const other = makeRepo();
  run(other, ['branch', 'only-in-the-other-repo']);
  await withStack({}, async ({ json }) => {
    for (const extra of [`&dir=${encodeURIComponent(other)}`, `&root=${encodeURIComponent(other)}`, `&repo=${encodeURIComponent(other)}`, `&cwd=${encodeURIComponent(other)}`]) {
      const r = await json('GET', `/api/review/branches?base=main${extra}`);
      assert.equal(r.status, 200);
      assert.ok(!r.body.refs.includes('only-in-the-other-repo'), 'the client cannot point Review at another repository');
    }
    const named = await json('GET', '/api/review/change?base=main&head=only-in-the-other-repo');
    assert.equal(named.status, 404, 'a branch of a different repository is not a branch of this project');
  });
});

test('no project, or a directory that is not a git repository, is a plain 400', async () => {
  await withStack({ repo: null }, async ({ json }) => {
    const r = await json('GET', '/api/review/branches');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Pick a project/);
  });
  await withStack({ repo: makeTempDir('construct-review-nogit-') }, async ({ json }) => {
    const r = await json('GET', '/api/review/branches');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not inside a git repository/);
  });
});

// --- the list source --------------------------------------------------------

test('the local-branches source lists exactly the repository branches and picks main as the default base', () => {
  const repo = makeRepo();
  const listing = listLocalBranches(repo);
  assert.equal(listing.ok, true);
  assert.deepEqual(listing.branches.map((b) => b.name).sort(), ['change', 'docs', 'main']);
  assert.equal(listing.current, 'main');
  assert.equal(defaultBase(listing.branches, listing.current), 'main');
  assert.equal(resolveListed(listing.branches, 'change').name, 'change');
  assert.equal(resolveListed(listing.branches, 'chang'), null, 'exact match only, no prefix or fuzzy match');
  assert.equal(resolveListed(listing.branches, ['change']), null);
});

test('GET /branches lists every other branch with how far ahead it is and no analysis yet', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('GET', '/api/review/branches');
    assert.equal(r.status, 200);
    assert.equal(r.body.base, 'main');
    assert.equal(r.body.source.id, 'local-branches');
    assert.deepEqual(r.body.branches.map((b) => b.name).sort(), ['change', 'docs']);
    assert.ok(r.body.branches.every((b) => b.ahead === 1 && b.analysis.state === 'none'));
  });
});

// --- analysis, off the request thread ---------------------------------------

test('analysis runs in a child process (not on the request thread) and returns the five indicators, no plan needed', async () => {
  await withStack({}, async ({ json, repo }) => {
    const before = snapshot(repo);
    const queued = await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change', 'docs'] } });
    assert.equal(queued.status, 202);
    assert.deepEqual(queued.body.queued, ['change', 'docs']);
    // The request returned while the work had only just begun: the server stays responsive meanwhile.
    const health = await json('GET', '/api/review/branches');
    assert.equal(health.status, 200);
    const done = await until(async () => {
      const r = await json('GET', '/api/review/change?base=main&head=change');
      return r.body.state === 'done' ? r.body : null;
    }, 'the analysis of `change`');
    assert.equal(done.report.kind, 'pr-health');
    assert.deepEqual(done.report.indicators.map((i) => i.id), ['blast-radius', 'unexplained', 'rule-regressions', 'public-surface', 'flow-diff']);
    const scope = done.report.indicators[0];
    assert.equal(scope.measured, false, 'no plan: the scope indicator is not measured');
    assert.equal(scope.status, 'not-measured');
    assert.ok(done.units.some((u) => u.path === 'features/billing/domain/billingRules.ts' && /billing/i.test(u.summary)), 'each changed unit says what it now does');
    assert.notEqual(done.report.request.expected, 'plan');
    // The row badges are the same computation, slimmed.
    await until(async () => (await json('GET', '/api/review/change?base=main&head=docs')).body.state === 'done', 'the analysis of `docs`');
    const list = await json('GET', '/api/review/branches');
    const row = list.body.branches.find((b) => b.name === 'change');
    assert.equal(row.analysis.state, 'done');
    assert.equal(row.analysis.indicators.length, 5);
    assert.ok(row.analysis.files >= 2);
    assert.deepEqual(snapshot(repo), before, 'analysing changes nothing in the user repository');
  });
});

test('the engine runs in a different process from the server', async () => {
  const repo = makeRepo();
  const listing = listLocalBranches(repo);
  const sha = (n) => listing.branches.find((b) => b.name === n).sha;
  const result = await forkRunner({ root: listing.top, baseSha: sha('main'), headSha: sha('change') });
  assert.equal(result.ok, true);
  assert.notEqual(result.worker.pid, process.pid, 'the engine ran in a child process, not on the request thread');
});

test('a slow analysis does not block other requests, and asking twice does not run it twice', async () => {
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const runner = async () => { started += 1; await gate; return { ok: false, error: { code: 'STUB', message: 'stub' } }; };
  await withStack({ runner }, async ({ json, jobs }) => {
    await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] } });
    await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] } });
    await until(() => started === 1, 'the job to start');
    const t = Date.now();
    const r = await json('GET', '/api/review/branches');
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t < 1500, 'the server answered while a job was in flight');
    assert.equal(r.body.branches.find((b) => b.name === 'change').analysis.state, 'running');
    assert.equal(started, 1, 'a second ask for the same commits is served by the first');
    release();
    await until(() => jobs.pending() === 0, 'the queue to drain');
    assert.equal((await json('GET', '/api/review/change?base=main&head=change')).body.state, 'error');
  });
});

test('a failed analysis is reported as an error state, not a crash', async () => {
  await withStack({ runner: async () => { throw new Error('boom'); } }, async ({ json }) => {
    await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] } });
    const r = await until(async () => {
      const x = await json('GET', '/api/review/change?base=main&head=change');
      return x.body.state === 'error' ? x.body : null;
    }, 'the error');
    assert.equal(r.error.code, 'WORKER_FAILED');
  });
});

test('review is read-only: the working tree, branches, stash and worktree list are byte-identical afterwards', async () => {
  await withStack({}, async ({ json, jobs, repo }) => {
    write(repo, 'scratch-uncommitted.txt', 'not committed\n');
    const before = snapshot(repo);
    const files = fs.readdirSync(repo).sort();
    await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change', 'docs'] } });
    await until(() => jobs.pending() === 0, 'all analyses');
    await json('GET', '/api/review/branches');
    await json('GET', '/api/review/change?base=main&head=change');
    assert.deepEqual(snapshot(repo), before);
    assert.deepEqual(fs.readdirSync(repo).sort(), files);
    assert.equal(fs.readFileSync(path.join(repo, 'scratch-uncommitted.txt'), 'utf8'), 'not committed\n');
  });
});

// --- #316: a plan as the expected scope --------------------------------------

test('GET /plans lists the saved plans of the project (id, title, what they declare) and nothing else', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('GET', '/api/review/plans');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.plans.map((p) => p.id), ['proc-billing', 'proc-all']);
    assert.deepEqual(r.body.plans[1], { id: 'proc-all', title: 'Billing and checkout', state: 'succeeded', features: ['billing', 'checkout'], files: 0 });
    assert.equal(JSON.stringify(r.body).includes('steps'), false, 'the plan body itself is not shipped');
  });
});

const BAD_PLANS = ['../../etc/passwd', '--upload-pack=x', '-x', 'nope', 'PROC-BILLING', 'proc-billing/../proc-all', '/etc/passwd', 'proc-billing\n'];

test('a plan id that is not exactly a saved plan is refused with 404 on analyze and change, and starts no work', async () => {
  const started = [];
  await withStack({ runner: async (job) => { started.push(job); return { ok: false, error: { code: 'X', message: 'x' } }; } }, async ({ json }) => {
    for (const bad of BAD_PLANS) {
      const a = await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'], plan: bad } });
      assert.equal(a.status, 404, `analyze plan=${JSON.stringify(bad)}`);
      const c = await json('GET', `/api/review/change?base=main&head=change&plan=${encodeURIComponent(bad)}`);
      assert.equal(c.status, 404, `change plan=${JSON.stringify(bad)}`);
    }
    const notString = await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'], plan: { id: 'proc-all' } } });
    assert.equal(notString.status, 400);
    assert.equal(started.length, 0, 'a refused plan starts nothing');
  });
});

test('a `-` branch is still refused when a plan is supplied', async () => {
  await withStack({}, async ({ json }) => {
    const r = await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['-x'], plan: 'proc-all' } });
    assert.equal(r.status, 400);
  });
});

test('a chosen plan becomes the engine\'s expected scope, read from the store, and is compared both ways', async () => {
  const seen = [];
  await withStack({}, async ({ json, repo }) => {
    const before = snapshot(repo);
    const q = await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'], plan: 'proc-billing' } });
    assert.equal(q.status, 202);
    const done = await until(async () => {
      const r = await json('GET', '/api/review/change?base=main&head=change&plan=proc-billing');
      return r.body.state === 'done' ? r.body : null;
    }, 'the analysis of `change` against a plan');
    seen.push(done);
    assert.deepEqual(done.plan, { id: 'proc-billing', title: 'Billing only' });
    const scope = done.report.indicators.find((i) => i.id === 'blast-radius');
    assert.equal(scope.measured, true);
    assert.deepEqual(scope.evidence.declared.features, ['billing']);
    assert.deepEqual(scope.evidence.extraFeatures, ['checkout'], 'checkout changed but the plan did not declare it');
    // The same commits with no plan are a separate, still-unmeasured result (the cache key includes the plan).
    const bare = await json('GET', '/api/review/change?base=main&head=change');
    assert.equal(bare.body.state, 'none');
    assert.equal(bare.body.plan, null);
    assert.deepEqual(snapshot(repo), before, 'nothing in the repository changed');
  });
  assert.equal(seen.length, 1);
});

test('no project means no plans, as a plain 400', async () => {
  await withStack({ repo: null }, async ({ json }) => {
    assert.equal((await json('GET', '/api/review/plans')).status, 400);
  });
});

// --- #351: an analysis is a Process, cancellable, read-only, never an approval ------------------------

const SLOW_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reviewWorker.slow.fixture.mjs');
const analysisProcesses = (service) => service.store().all().processes.filter((p) => isAnalysisPlan(p.plan));
const botRefs = (repo) => run(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads/construct/']);
const ourTrees = (pid) => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`construct-prhealth-${pid}-`));

test('an analysis is a process: it is in the store and the drawer summary, with the machine\'s own controls', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const runner = async () => { await gate; return { ok: false, error: { code: 'STUB', message: 'stub' } }; };
  await withStack({ runner }, async ({ json, service, jobs }) => {
    await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] } });
    await until(() => analysisProcesses(service).length === 1 && jobs.pending() === 1, 'the process');
    const [record] = analysisProcesses(service);
    assert.equal(record.plan.steps.length, 1);
    assert.equal(record.plan.steps[0].flow, 'review.analyze');
    assert.equal(record.plan.steps[0].executor, 'deterministic');
    assert.match(record.plan.steps[0].args.head, /^[0-9a-f]{40}$/, 'the plan carries commit ids, not the client\'s branch string');
    const listed = service.list().processes.find((p) => p.id === record.id);
    assert.ok(listed, 'it is listed for the Processes drawer');
    assert.ok(listed.controls.includes('CANCEL'), 'the machine offers Cancel');
    const row = (await json('GET', '/api/review/branches')).body.branches.find((b) => b.name === 'change').analysis;
    assert.equal(row.processId, record.id, 'the row knows its process, so the UI can point at the drawer');
    release();
    await until(() => jobs.pending() === 0, 'the analysis to finish');
  });
});

test('analysis processes are not offered as plans to compare against', () => {
  const analysis = { id: 'proc-a', title: 'Review x', plan: { steps: [{ id: 'analyse', flow: 'review.analyze', touches: { features: ['billing'], files: [] } }] } };
  const source = createPlanSource({ records: () => [...RECORDS, analysis] });
  assert.deepEqual(source.list().map((p) => p.id), ['proc-billing', 'proc-all']);
  assert.equal(source.resolve('proc-a'), null);
});

test('a finished analysis ends with ZERO artifacts, needs no approval, and leaves every part of the repository byte-identical', async () => {
  await withStack({}, async ({ json, jobs, repo, service }) => {
    write(repo, 'scratch-uncommitted.txt', 'not committed\n');
    const before = snapshot(repo);
    await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] } });
    await until(() => jobs.pending() === 0 && analysisProcesses(service).length === 1, 'the analysis');
    const [record] = analysisProcesses(service);
    const detail = service.detail(record.id).body.process;
    assert.equal(detail.summary.state, 'done');
    assert.deepEqual(detail.artifacts, [], 'an analysis produces no artifacts');
    assert.equal(detail.summary.artifacts, 0);
    assert.equal(detail.summary.pendingApproval, 0, 'nothing for the approval gate to review');
    assert.equal(botRefs(repo), '', 'no bot branch was created (the bot runner is never involved)');
    assert.deepEqual(snapshot(repo), before, 'status, refs, stash and worktree list are byte-identical');
    const gate = service.review(record.id);
    assert.deepEqual(gate.body.artifacts ?? [], [], 'the approval gate has nothing to review for it');
    const decided = service.decide(record.id, { by: 'tester', path: 'README.md', verdict: 'approve', diffSha256: 'f'.repeat(64) });
    assert.notEqual(decided.status, 200, 'there is no file an approval could apply');
    assert.deepEqual(snapshot(repo), before, 'and trying changes nothing');
  });
});

test('cancel mid-analysis: the process is cancelled with the machine\'s own control, the worker is gone and its checkouts are cleaned up', async () => {
  const marker = path.join(makeTempDir('og351-marker-'), 'worker.json');
  process.env.OG351_MARKER = marker;
  try {
    await withStack({ runOptions: { worker: SLOW_WORKER, graceMs: 300 } }, async ({ json, jobs, repo, service }) => {
      write(repo, 'scratch-uncommitted.txt', 'not committed\n');
      const before = snapshot(repo);
      await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] } });
      const worker = await until(() => (fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : null), 'the worker to hold its checkouts');
      // Precondition of the proof: the debris this test is about really exists right now.
      assert.ok(ourTrees(worker.pid).length > 0, 'a temporary directory exists');
      assert.ok(run(repo, ['worktree', 'list', '--porcelain']).includes(`construct-prhealth-${worker.pid}-`), 'git has the temporary worktrees registered');
      const row = (await json('GET', '/api/review/branches')).body.branches.find((b) => b.name === 'change').analysis;
      assert.equal(row.state, 'running');

      const res = await json('POST', '/api/review/cancel', { body: { base: 'main', head: 'change' } });
      assert.equal(res.status, 200);
      const after = await until(async () => {
        const r = await json('GET', '/api/review/change?base=main&head=change');
        return r.body.state === 'cancelled' ? r.body : null;
      }, 'the analysis to be cancelled');
      assert.equal(after.state, 'cancelled');

      const [record] = analysisProcesses(service);
      assert.equal(service.detail(record.id).body.process.summary.state, 'cancelled');
      assert.deepEqual(record.artifacts, []);
      assert.throws(() => process.kill(worker.pid, 0), (e) => e.code === 'ESRCH', 'the worker process is gone');
      assert.deepEqual(ourTrees(worker.pid), [], 'its temporary directory is removed');
      assert.equal(run(repo, ['worktree', 'list', '--porcelain']).includes('construct-prhealth-'), false, 'no worktree registration is left');
      assert.equal(botRefs(repo), '');
      assert.deepEqual(snapshot(repo), before, 'status, refs, stash and worktree list are byte-identical after a cancel');
      assert.equal(jobs.pending(), 0);
      // Asking again starts a fresh analysis (a cancelled one is not served from memory).
      fs.rmSync(marker, { force: true });
      await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] } });
      await until(() => fs.existsSync(marker), 'a second run');
      await json('POST', '/api/review/cancel', { body: { base: 'main', head: 'change' } });
      await until(async () => (await json('GET', '/api/review/change?base=main&head=change')).body.state === 'cancelled', 'the second cancel');
      assert.deepEqual(snapshot(repo), before);
    });
  } finally {
    delete process.env.OG351_MARKER;
  }
});

test('cancel is refused for anything that is not exactly a live analysis, and starts and cancels nothing else', async () => {
  let started = 0;
  await withStack({ runner: async () => { started += 1; return { ok: false, error: { code: 'X', message: 'x' } }; } }, async ({ json, call }) => {
    for (const [label, ref] of BAD_REFS) {
      const r = await json('POST', '/api/review/cancel', { body: { base: 'main', head: ref } });
      assert.ok([400, 404].includes(r.status), `${label} as head: got ${r.status}`);
      const b = await json('POST', '/api/review/cancel', { body: { base: ref, head: 'change' } });
      assert.ok([400, 404].includes(b.status), `${label} as base: got ${b.status}`);
    }
    const noPlan = await json('POST', '/api/review/cancel', { body: { base: 'main', head: 'change', plan: 'nope' } });
    assert.equal(noPlan.status, 404);
    const idle = await json('POST', '/api/review/cancel', { body: { base: 'main', head: 'change' } });
    assert.equal(idle.status, 404, 'nothing is running: an unknown analysis is a 404, not a success');
    assert.equal(idle.body.code, 'NOT_RUNNING');
    const foreign = await call('POST', '/api/review/cancel', { body: { base: 'main', head: 'change' }, headers: { origin: 'http://evil.example' } });
    assert.equal(foreign.status, 403, 'a foreign Origin cannot cancel');
    const foreignStart = await call('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] }, headers: { origin: 'http://evil.example' } });
    assert.equal(foreignStart.status, 403, 'a foreign Origin cannot start');
    assert.equal(started, 0, 'no refusal started anything');
  });
});

test('a process id from the client is never how cancel is addressed: the comparison is, and it is looked up', async () => {
  const untilAborted = (job, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, error: { code: 'CANCELLED', message: 'cancelled' } })));
  await withStack({ runner: untilAborted }, async ({ json, service, jobs }) => {
    await json('POST', '/api/review/analyze', { body: { base: 'main', heads: ['change'] } });
    await until(() => analysisProcesses(service).length === 1, 'the process');
    const [record] = analysisProcesses(service);
    // Naming a process id in the body changes nothing: only the (validated) comparison selects what is cancelled.
    const r = await json('POST', '/api/review/cancel', { body: { base: 'main', head: 'docs', processId: record.id } });
    assert.equal(r.status, 404);
    assert.equal(jobs.pending(), 1, 'the analysis of `change` is still running');
    const drawer = service.control('proc_unknown', 'cancel');
    assert.equal(drawer.status, 404, 'the drawer\'s cancel of an unknown process id is a 404');
    await json('POST', '/api/review/cancel', { body: { base: 'main', head: 'change' } });
    await until(() => jobs.pending() === 0, 'the cancel to settle');
  });
});

test('a step that is not a valid analysis is refused before anything is read (a plan is an input too)', async () => {
  const calls = [];
  const exec = createReviewExecutor({ run: async (job) => { calls.push(job); return { ok: false, error: { code: 'X', message: 'x' } }; } });
  const repo = makeRepo();
  const ctx = (args) => ({ process: { id: 'p', projectRoot: repo }, step: { id: 'analyse', flow: 'review.analyze', args }, signal: new AbortController().signal, log: () => {} });
  for (const args of [{ base: '--output=x', head: 'a'.repeat(40) }, { base: 'main', head: 'change' }, { base: 'a'.repeat(40), head: '../x' }, { base: 1, head: 2 }, {}]) {
    const r = await exec.executeStep(ctx(args));
    assert.equal(r.ok, false);
    assert.deepEqual(r.artifacts, []);
  }
  assert.equal(calls.length, 0, 'nothing was spawned for a step that names refs instead of commit ids');
});
