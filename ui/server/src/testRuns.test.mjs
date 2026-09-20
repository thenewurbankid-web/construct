// #305 -- running tests from the Cockpit. Security first (401 on every route, the route sits after the gate, hostile
// names and addresses refused before anything starts, a foreign Origin refused, cancel addressed by the validated
// feature never a pid), then behaviour (a run is a Process, read-only, no artifacts, one live run per feature, cancel
// leaves nothing behind). Playwright is replaced by a stand-in `@playwright/test/cli.js` inside the throwaway project.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { generateFeatureTests } from '../../../src/engine/testGenerator.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createTestsRouter } from './testsApi.mjs';
import { createProcessesService } from './processesService.mjs';
import { composeExecutors } from './reviewAnalyses.mjs';
import { createTestRunExecutor, createTestRuns, createTestRunJobs, createRunResults, forkTestRun, isTestRunPlan, testRunPlan } from './testRuns.mjs';
import { createPlanSource } from './reviewPlans.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;
const LOCK_YML = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE_YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const MACHINE = `import { setup } from 'xstate';
export const Simple = setup({}).createMachine({
  id: 'simple',
  initial: 'idle',
  states: { idle: { on: { START_JOB: 'working' } }, working: { on: { finishJob: 'done' } }, done: { type: 'final' } },
});
`;
const HARNESS = 'Test harness problem, not a bug in the page: the test harness expected [data-testid="finish-job"]. It is what the workflow event finishJob binds to. Construct binds workflow events to elements by convention (data-testid = the event name in kebab-case). Add the attribute; do not file a product bug for this.';

function project() {
  const dir = makeTempDir('construct-testruns-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + LOCK_YML);
  for (const l of ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components']) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), MACHINE);
  generateFeatureTests(dir, 'jobs');
  return dir;
}
const firstGenerated = (dir) => fs.readdirSync(path.join(dir, 'features', 'jobs', 'tests', 'generated')).sort()[0];

/** A stand-in Playwright inside the project: writes `report` to the report file, or waits to be stopped. */
function fakePlaywright(dir, { report = null, sleep = false } = {}) {
  const cli = path.join(dir, 'node_modules', '@playwright', 'test', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, `const fs = require('fs');
const cfg = require(process.argv[process.argv.indexOf('--config') + 1]);
${sleep ? "setInterval(() => {}, 1000);" : `fs.writeFileSync(cfg.reporter[0][1].outputFile, ${JSON.stringify(JSON.stringify(report))});`}
`);
}
const reportFor = (dir, tests) => {
  const gen = firstGenerated(dir);
  return { suites: [{ title: gen, file: `generated/${gen}`, specs: tests.map((t) => ({ title: t.title, file: `generated/${gen}`, tests: [{ status: t.status, annotations: [], results: [{ status: t.result, duration: 900, errors: t.error ? [{ message: t.error }] : [] }] }] })) }] };
};

async function until(fn, what) {
  for (let i = 0; i < 1500; i += 1) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The real wiring of index.mjs with a private state directory: a run is a Process in a real store, driven by the real
 * engine, executed by the test-run executor (never the bot runner). */
async function withStack({ authOn = true, dir = project(), run, runOptions = {} } = {}, fn) {
  const testResults = createRunResults();
  const testRunExecutor = createTestRunExecutor({ ...(run ? { run } : {}), runOptions, results: testResults });
  const botRefused = async () => ({ ok: false, llm: null, error: 'a bot step must not run in this test' });
  const service = createProcessesService({
    getProjectDir: () => dir,
    stateDir: makeTempDir('og305-state-'),
    executeStep: composeExecutors({ bot: botRefused, review: botRefused, testRun: testRunExecutor.executeStep }),
  });
  const jobs = createTestRunJobs({ runs: createTestRuns({ service, results: testResults }) });
  const auth = createAuth(resolveAuthConfig(authOn ? ENV : {}, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/tests', createTestsRouter({ clientOrigin: ORIGIN, runs: jobs, getRoot: () => ({ ok: true, root: dir }) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, cookie: cookie(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (method, p, opts) => { const r = await call(method, p, opts); return { status: r.status, body: await r.json() }; };
  try {
    await fn({ dir, call, json, jobs, service });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}
const runRecords = (service) => service.store().all().processes.filter((p) => isTestRunPlan(p.plan));

// --- security --------------------------------------------------------------

test('every run route is refused with 401 when there is no session, and starts nothing', async () => {
  await withStack({}, async ({ call, service }) => {
    for (const [method, p, body] of [
      ['GET', '/api/tests/jobs/runs'],
      ['POST', '/api/tests/jobs/run', {}],
      ['POST', '/api/tests/jobs/run/cancel', {}],
    ]) {
      const res = await call(method, p, { body, headers: { cookie: '' } });
      assert.equal(res.status, 401, `${method} ${p} must need a session`);
    }
    assert.equal(runRecords(service).length, 0);
    assert.equal((await call('GET', '/api/tests/jobs/runs')).status, 200);
  });
});

test('the real server has the run routes AFTER the session gate (they live on the tests router)', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const router = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/tests'));
  assert.ok(gate >= 0 && router > gate);
  const tests = stack[router].handle.stack.map((l) => l.route?.path).filter(Boolean);
  for (const p of ['/:feature/runs', '/:feature/run', '/:feature/run/cancel']) assert.ok(tests.includes(p), p);
});

test('a foreign Origin is refused on start and cancel, and a body that is not JSON is a 415', async () => {
  await withStack({}, async ({ call, service }) => {
    for (const p of ['/api/tests/jobs/run', '/api/tests/jobs/run/cancel']) {
      const r = await call('POST', p, { body: {}, headers: { origin: 'http://evil.example' } });
      assert.equal(r.status, 403, p);
      assert.equal((await call('POST', p)).status, 415, `${p} with no JSON body`);
    }
    assert.equal(runRecords(service).length, 0);
  });
});

test('hostile names, areas and addresses are refused before anything starts', async () => {
  let spawned = 0;
  await withStack({ run: async () => { spawned += 1; return { ok: false, error: { code: 'X', message: 'x' } }; } }, async ({ json, call, dir, service, jobs }) => {
    const gen = firstGenerated(dir);
    const bad = [
      ['a path as the name', { name: '../../../etc/passwd', area: 'generated' }],
      ['an absolute path', { name: '/etc/passwd', area: 'generated' }],
      ['a glob', { name: '*.spec.ts', area: 'generated' }],
      ['an option', { name: '--config=/tmp/x', area: 'generated' }],
      ['a folder in the name', { name: `generated/${gen}`, area: 'yours' }],
      ['right name, wrong area', { name: gen, area: 'yours' }],
      ['a name with no area', { name: gen }],
      ['an area that does not exist', { name: gen, area: 'other' }],
      ['a name that is not a string', { name: 5, area: 'generated' }],
      ['a name that is not a file', { name: 'missing.spec.ts', area: 'yours' }],
      ['a remote address', { baseUrl: 'https://example.com' }],
      ['an address with credentials', { baseUrl: 'http://a:b@localhost:3000' }],
      ['an address with a path', { baseUrl: 'http://localhost:3000/admin' }],
      ['an option as the address', { baseUrl: '--proxy-server=x' }],
      ['an address that is not a string', { baseUrl: { a: 1 } }],
    ];
    for (const [label, body] of bad) {
      const r = await json('POST', '/api/tests/jobs/run', { body });
      assert.ok([400, 404].includes(r.status), `${label}: got ${r.status}`);
      assert.equal(r.body.ok, false, label);
    }
    assert.equal(spawned, 0);
    assert.equal(runRecords(service).length, 0, 'a refused request creates no process');
    assert.equal(jobs.pending(), 0);
    for (const f of ['..', '%2e%2e', 'a%00b', '.git']) assert.ok([400, 404].includes((await call('POST', `/api/tests/${f}/run`, { body: {} })).status), f);
    assert.equal((await json('POST', '/api/tests/nosuch/run', { body: {} })).status, 404);
    assert.equal((await json('GET', '/api/tests/nosuch/runs')).status, 404);
    assert.equal((await json('POST', '/api/tests/nosuch/run/cancel', { body: {} })).status, 404);
  });
});

test('cancel is addressed by the validated feature: a process id, a pid or extra fields in the body change nothing', async () => {
  const untilAborted = (job, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, error: { code: 'CANCELLED', message: 'cancelled' } })));
  await withStack({ run: untilAborted }, async ({ json, service, jobs }) => {
    assert.equal((await json('POST', '/api/tests/jobs/run/cancel', { body: {} })).status, 404, 'nothing live: a plain 404');
    await json('POST', '/api/tests/jobs/run', { body: {} });
    await until(() => jobs.pending() === 1, 'the run');
    const [record] = runRecords(service);
    const r = await json('POST', '/api/tests/jobs/run/cancel', { body: { processId: 'proc_other', pid: 1, id: record.id } });
    assert.equal(r.status, 200);
    await until(() => jobs.pending() === 0, 'the cancel to settle');
    assert.equal(service.control('proc_unknown', 'cancel').status, 404);
  });
});

test('a step that is not a valid run is refused before anything is spawned (a plan is an input too)', async () => {
  const calls = [];
  const exec = createTestRunExecutor({ run: async (job) => { calls.push(job); return { ok: false, error: { code: 'X', message: 'x' } }; } });
  const dir = project();
  const ctx = (args, flow = 'test.run') => ({ process: { id: 'p', projectRoot: dir }, step: { id: 'run', flow, args }, signal: new AbortController().signal, log: () => {} });
  const gen = firstGenerated(dir);
  for (const args of [{ feature: '../x' }, { feature: 'jobs', name: '../../x.spec.ts', area: 'yours' }, { feature: 'jobs', name: gen }, { feature: 'jobs', area: 'generated' }, { feature: 'jobs', 'base-url': 'https://example.com' }, { feature: 'jobs', 'base-url': 'http://localhost:3000/x' }, { feature: 5 }, {}, { feature: 'jobs', name: 'nope.spec.ts', area: 'yours' }]) {
    const r = await exec.executeStep(ctx(args));
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.deepEqual(r.artifacts, []);
  }
  assert.equal((await exec.executeStep(ctx({ feature: 'jobs' }, 'validate'))).ok, false);
  assert.equal(calls.length, 0);
});

test('a test.run step with no test executor is refused, never handed to the bot runner', async () => {
  const bot = async () => ({ ok: true, llm: null, artifacts: [] });
  const r = await composeExecutors({ bot, review: bot })({ step: { flow: 'test.run' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /not available/);
});

// --- behaviour -------------------------------------------------------------

test('a run is a process: read-only, zero artifacts, one live run per feature, and the result is read back by feature', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const seen = [];
  const run = async (job) => {
    seen.push(job);
    await gate;
    return {
      ok: true, feature: 'jobs', baseUrl: job.baseUrl, durationMs: 4000, counts: { total: 2, passed: 1, failed: 1, notRun: 0 },
      tests: [{ file: 'a.spec.ts', area: 'generated', title: 'Happy path', status: 'passed', durationMs: 900 }, { file: 'b.spec.ts', area: 'generated', title: 'Broken', status: 'failed', durationMs: 800, failure: { kind: 'app', summary: 'Expected the flow to reach "done", it reached "working".', expected: 'done', reached: 'working', message: 'm' } }],
    };
  };
  await withStack({ run }, async ({ json, service, jobs }) => {
    const started = await json('POST', '/api/tests/jobs/run', { body: { baseUrl: 'http://127.0.0.1:5173' } });
    assert.equal(started.status, 202);
    assert.equal(started.body.live.state === 'queued' || started.body.live.state === 'running', true);
    await until(() => seen.length === 1, 'the worker to be asked');
    assert.equal(seen[0].baseUrl, 'http://127.0.0.1:5173');
    assert.equal(seen[0].feature, 'jobs');
    assert.equal(seen[0].name, undefined);
    const [record] = runRecords(service);
    assert.equal(record.plan.steps[0].flow, 'test.run');
    assert.equal(record.plan.steps[0].executor, 'deterministic');
    assert.deepEqual(record.plan.steps[0].args, { feature: 'jobs', 'base-url': 'http://127.0.0.1:5173' });
    assert.ok(service.list().processes.find((p) => p.id === record.id).controls.includes('CANCEL'), 'the machine offers Cancel in the drawer too');
    const second = await json('POST', '/api/tests/jobs/run', { body: {} });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'RUN_IN_PROGRESS');
    assert.equal(runRecords(service).length, 1, 'no second process');
    release();
    await until(() => jobs.pending() === 0, 'the run to finish');
    const read = (await json('GET', '/api/tests/jobs/runs')).body;
    assert.equal(read.live, null);
    assert.equal(read.problem, null);
    assert.deepEqual(read.tests.map((t) => t.status), ['passed', 'failed']);
    assert.equal(read.tests[1].failure.kind, 'app');
    assert.deepEqual(read.lastRun.counts, { total: 2, passed: 1, failed: 1, notRun: 0 });
    const detail = service.detail(record.id).body.process;
    assert.equal(detail.summary.state, 'done', 'a failing test is a result; the process itself ran and reported');
    assert.deepEqual(detail.artifacts, []);
    assert.equal(detail.summary.pendingApproval, 0);
    assert.ok(detail.log.some((l) => l.provenance === 'warn' && /Broken/.test(l.message)), 'the log distinguishes a failure');
    assert.equal((await json('POST', '/api/tests/jobs/run', { body: {} })).status, 202, 'once it is finished a new run may start');
    await until(() => jobs.pending() === 0 && runRecords(service).length === 2, 'the second run');
  });
});

test('running one test names it by file and area; only what is on disk is accepted', async () => {
  const seen = [];
  await withStack({ run: async (job) => { seen.push(job); return { ok: false, error: { code: 'X', message: 'x' } }; } }, async ({ json, dir, jobs, service }) => {
    const gen = firstGenerated(dir);
    assert.equal((await json('POST', '/api/tests/jobs/run', { body: { name: gen, area: 'generated' } })).status, 202);
    await until(() => seen.length === 1 && jobs.pending() === 0, 'the run');
    assert.deepEqual([seen[0].name, seen[0].area], [gen, 'generated']);
    assert.deepEqual(runRecords(service)[0].plan.steps[0].args.name, gen);
    const read = (await json('GET', '/api/tests/jobs/runs')).body;
    assert.equal(read.problem.code, 'X', 'a run that produced no result is reported as the problem, in its own words');
    assert.deepEqual(read.problem.target, { name: gen, area: 'generated' });
  });
});

test('test runs are not offered as plans to compare against in Review mode', () => {
  const run = { id: 'proc-r', title: 'Run', plan: testRunPlan({ feature: 'jobs', origin: 'http://localhost:3000' }) };
  const keep = { id: 'proc-keep', title: 'A plan', plan: { steps: [{ id: 's1', touches: { features: ['billing'], files: [] } }] } };
  const source = createPlanSource({ records: () => [run, keep] });
  assert.deepEqual(source.list().map((p) => p.id), ['proc-keep']);
});

// --- the real worker, a stand-in Playwright ------------------------------------------------------------------------

test('the real forked worker runs the tests through a stand-in Playwright, and the result is classified', async () => {
  const dir = project();
  fakePlaywright(dir, { report: reportFor(dir, [{ title: 'Happy path', status: 'expected', result: 'passed' }, { title: 'Missing id', status: 'unexpected', result: 'failed', error: HARNESS }]) });
  await withStack({ dir, run: (job, o) => forkTestRun(job, { ...o }) }, async ({ json, jobs }) => {
    // the app is "up": a tiny server answers the preflight
    const app = http.createServer((q, s) => s.end('ok'));
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    try {
      const baseUrl = `http://127.0.0.1:${app.address().port}`;
      assert.equal((await json('POST', '/api/tests/jobs/run', { body: { baseUrl } })).status, 202);
      await until(() => jobs.pending() === 0, 'the run', 20000);
      const read = (await json('GET', '/api/tests/jobs/runs')).body;
      assert.deepEqual(read.tests.map((t) => t.status), ['passed', 'failed']);
      assert.equal(read.tests[1].failure.kind, 'convention');
      assert.match(read.tests[1].failure.message, /Test harness problem, not a bug in the page/);
      assert.equal(read.lastRun.baseUrl, baseUrl);
    } finally {
      app.close();
    }
  });
});

test('an app that is not running is one clear message, not a wall of timeouts', async () => {
  const dir = project();
  fakePlaywright(dir, { report: { suites: [] } });
  await withStack({ dir, run: (job, o) => forkTestRun(job, { ...o }) }, async ({ json, jobs }) => {
    await json('POST', '/api/tests/jobs/run', { body: { baseUrl: 'http://127.0.0.1:1' } });
    await until(() => jobs.pending() === 0, 'the run', 20000);
    const read = (await json('GET', '/api/tests/jobs/runs')).body;
    assert.equal(read.problem.code, 'APP_UNREACHABLE');
    assert.match(read.problem.message, /Nothing answered at http:\/\/127\.0\.0\.1:1/);
    assert.deepEqual(read.tests, []);
  });
});

const ours = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('construct-testrun-'));

test('cancel mid-run: the process is cancelled with the machine\'s own control, Playwright is gone and its temp directory is removed', async () => {
  const dir = project();
  fakePlaywright(dir, { sleep: true });
  const before = new Set(ours());
  await withStack({ dir, run: (job, o) => forkTestRun(job, { ...o, graceMs: 500 }) }, async ({ json, jobs, service }) => {
    const app = http.createServer((q, s) => s.end('ok'));
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    try {
      await json('POST', '/api/tests/jobs/run', { body: { baseUrl: `http://127.0.0.1:${app.address().port}` } });
      const mine = await until(() => ours().find((n) => !before.has(n) && fs.existsSync(path.join(os.tmpdir(), n, 'playwright.pid'))), 'Playwright to be running');
      const pid = Number(fs.readFileSync(path.join(os.tmpdir(), mine, 'playwright.pid'), 'utf8'));
      assert.doesNotThrow(() => process.kill(pid, 0), 'Playwright is really running right now');
      const read = (await json('GET', '/api/tests/jobs/runs')).body;
      assert.equal(read.live.state, 'running');
      assert.equal((await json('POST', '/api/tests/jobs/run/cancel', { body: {} })).status, 200);
      await until(() => jobs.pending() === 0, 'the cancel to settle', 20000);
      const [record] = runRecords(service);
      assert.equal(service.detail(record.id).body.process.summary.state, 'cancelled');
      const after = (await json('GET', '/api/tests/jobs/runs')).body;
      assert.equal(after.problem.state, 'cancelled');
      await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 'Playwright to be gone');
      assert.deepEqual(ours().filter((n) => !before.has(n)), [], 'no temp directory of the run is left');
    } finally {
      app.close();
    }
  });
});
