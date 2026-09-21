// #305 -- running a feature's tests as a block: which specs (from disk, never from the caller's string), where the app is,
// how a failure is classified (convention vs app), and stopping a run cleanly. Playwright itself is replaced by a tiny
// stand-in `@playwright/test/cli.js` here so the suite is fast and needs no browser; the real thing, in a real
// browser, is proven by ui/e2e/tests/tests-run.spec.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { generateFeatureTests } from '../src/engine/testGenerator.mjs';
import { HELPERS } from '../src/engine/testSpecRender.mjs';
import { bugReportText, classifyFailure, findPlaywright, parseBaseUrl, readReport, configText, keepTraces, pruneTraceDirs, TRACE_DIR_PREFIX, TRACE_KEEP_DIRS, TRACE_MAX_FILE_BYTES, reclaimRunsOf, renderRunText, resolveSpecs, runFeatureTests, RUN_DIR_PREFIX } from '../src/engine/testRunner.mjs';

const LOCK = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const MACHINE = `import { setup } from 'xstate';
export const Jobs = setup({}).createMachine({
  id: 'jobs',
  initial: 'idle',
  states: {
    idle: { on: { START_JOB: 'working' } },
    working: { on: { finishJob: 'done' } },
    done: { type: 'final' },
  },
});
`;

function project() {
  const dir = makeTempDir('construct-testrun-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE + LOCK);
  for (const l of ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components']) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Jobs.ts'), MACHINE);
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'controllers', 'JobsController.tsx'), 'export function JobsController() {\n  return <div />;\n}\n');
  fs.mkdirSync(path.join(dir, 'app', 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'jobs', 'page.tsx'), "import { JobsController } from '../../features/jobs/controllers/JobsController';\n\nexport default function Page() {\n  return <JobsController />;\n}\n");
  generateFeatureTests(dir, 'jobs');
  return dir;
}

/** A stand-in Playwright: reads the config it is given and writes `report` to the report file (or sleeps). */
function fakePlaywright(root, { report = null, sleep = false, saw = null } = {}) {
  const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, `const fs = require('fs');
const cfg = require(process.argv[process.argv.indexOf('--config') + 1]);
${saw ? `fs.writeFileSync(${JSON.stringify(saw)}, JSON.stringify({ cfg, argv: process.argv.slice(2), cwd: process.cwd() }));` : ''}
${sleep ? "setInterval(() => {}, 1000); process.on('SIGTERM', () => setTimeout(() => process.exit(0), 50));" : `fs.writeFileSync(cfg.reporter[0][1].outputFile, ${JSON.stringify(JSON.stringify(report))});`}
`);
}

const HARNESS_TEXT = 'Test harness problem, not a bug in the page: the test harness expected [data-testid="finish-job"]. It is what the workflow event finishJob binds to. Construct binds workflow events to elements by convention (data-testid = the event name in kebab-case; data-flow / data-flow-state on the element that shows the machine\'s state). Add the attribute (or scaffold the page with `construct create page --from`); do not file a product bug for this.';

const oneSpec = (specs, file, tests) => ({ suites: [{ title: file, file, specs: tests.map((t) => ({ title: t.title, file, tests: [{ status: t.status, annotations: t.annotations ?? [], results: [{ status: t.result, duration: 1234, errors: t.error ? [{ message: t.error }] : [] }] }] })) }] });

test('the address of the app: a plain origin on this machine, nothing else', () => {
  assert.deepEqual(parseBaseUrl(undefined), { ok: true, origin: 'http://localhost:3000' });
  assert.deepEqual(parseBaseUrl('http://127.0.0.1:5173/'), { ok: true, origin: 'http://127.0.0.1:5173' });
  assert.equal(parseBaseUrl('http://[::1]:8080').ok, true);
  for (const bad of ['https://example.com', 'http://10.0.0.5:3000', 'ftp://localhost', 'http://user:pw@localhost:3000', 'http://localhost:3000/admin', 'http://localhost:3000/?a=1', 'http://localhost:3000 --x', 'localhost:3000', 'http://localhost.evil.com', 'javascript:alert(1)', 5, 'http://localhost:3000\n']) {
    const r = parseBaseUrl(bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.error.code, 'BAD_BASE_URL');
  }
});

test('the specs of a run come from the feature\'s own directories; a name is only compared with what is on disk', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'tests', 'mine.spec.ts'), '// written by QA\n');
  const all = resolveSpecs(dir, 'jobs');
  assert.equal(all.ok, true);
  assert.ok(all.specs.some((s) => s.area === 'generated' && s.rel.startsWith('generated/')));
  assert.ok(all.specs.some((s) => s.area === 'yours' && s.name === 'mine.spec.ts' && s.rel === 'mine.spec.ts'));
  const gen = all.specs.find((s) => s.area === 'generated');
  assert.deepEqual(resolveSpecs(dir, 'jobs', { name: gen.name, area: 'generated' }).specs.map((s) => s.name), [gen.name]);
  assert.equal(resolveSpecs(dir, 'jobs', { name: 'mine.spec.ts', area: 'generated' }).error.code, 'NOT_FOUND', 'right name, wrong directory');
  for (const name of ['../../../etc/passwd', '/etc/passwd', 'generated/../mine.spec.ts', 'mine.spec.ts\0', '--config=x', '*.spec.ts', 'nothing.spec.ts']) {
    assert.equal(resolveSpecs(dir, 'jobs', { name, area: 'yours' }).ok, false, name);
  }
  assert.equal(resolveSpecs(dir, 'jobs', { name: 'mine.spec.ts' }).error.code, 'BAD_TARGET', 'a name needs its area');
  assert.equal(resolveSpecs(dir, '../jobs').ok, false);
  assert.equal(resolveSpecs(dir, 'nope').ok, false);
});

test('a symlinked spec is never run', () => {
  const dir = project();
  const outside = path.join(makeTempDir('construct-testrun-out-'), 'evil.spec.ts');
  fs.writeFileSync(outside, "throw new Error('outside');\n");
  fs.symlinkSync(outside, path.join(dir, 'features', 'jobs', 'tests', 'link.spec.ts'));
  assert.equal(resolveSpecs(dir, 'jobs').specs.some((s) => s.name === 'link.spec.ts'), false);
  assert.equal(resolveSpecs(dir, 'jobs', { name: 'link.spec.ts', area: 'yours' }).ok, false);
});

test('a convention failure keeps the generator\'s own words and names the step, the event, the selector and the page', () => {
  const dir = project();
  const specs = resolveSpecs(dir, 'jobs').specs;
  const gen = specs.find((s) => s.area === 'generated' && /happy/.test(s.name));
  assert.ok(HELPERS.includes('Test harness problem, not a bug in the page'), 'the wording tested here is the wording the generator emits');
  const f = classifyFailure(`Error: ${HARNESS_TEXT}`, { specText: gen.text, origin: 'http://localhost:3000' });
  assert.equal(f.kind, 'convention');
  assert.equal(f.selector, '[data-testid="finish-job"]');
  assert.equal(f.event, 'finishJob');
  assert.equal(f.page, 'http://localhost:3000/jobs');
  assert.equal(f.step.n > 0, true);
  assert.match(f.step.sentence, /finish job/i);
  assert.match(f.message, /Test harness problem, not a bug in the page/);
  assert.match(f.fix, /architecture\.yml/);
});

test('an app failure says what was expected and what was reached; anything else is shown as it is and never called a bug', () => {
  const app = classifyFailure('Error: expect(locator).toHaveAttribute(expected) failed\n\nLocator: [data-flow="jobs"][data-flow-state]\nExpected string: "done"\nReceived string: "working"\nTimeout: 5000ms', {});
  assert.equal(app.kind, 'app');
  assert.equal(app.expected, 'done');
  assert.equal(app.reached, 'working');
  assert.equal(app.summary, 'Expected the flow to reach "done", it reached "working".');
  const ansi = classifyFailure('\u001b[2mExpected string: \u001b[22m"a"\n\u001b[2mReceived string: \u001b[22m"b"', {});
  assert.equal(ansi.kind, 'app', 'colour codes are stripped before reading');
  const other = classifyFailure('page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/jobs', {});
  assert.equal(other.kind, 'other');
  assert.equal(bugReportText({ feature: 'jobs', baseUrl: 'x', test: { title: 't', file: 'f', area: 'generated', failure: other } }), null);
  assert.equal(bugReportText({ feature: 'jobs', baseUrl: 'x', test: { title: 't', file: 'f', area: 'generated', failure: classifyFailure(HARNESS_TEXT, {}) } }), null, 'a harness problem is never offered as a bug report');
  const text = bugReportText({ feature: 'jobs', baseUrl: 'http://localhost:3000', test: { title: 'Happy path', file: 'a--b.spec.ts', area: 'generated', failure: app } });
  assert.match(text, /Expected: the flow reaches "done"/);
  assert.match(text, /Actual: it reached "working"/);
});

test('the code frame and stack Playwright appends are left out: no machine paths reach the screen', () => {
  const noisy = `Error: ${HARNESS_TEXT}\n\n  22 |\n  23 | const harness = (selector: string, why: string) =>\n> 24 |   new Error(\n     |   ^\n    at harness (/tmp/x/features/jobs/tests/generated/a.spec.ts:24:3)`;
  const f = classifyFailure(noisy, {});
  assert.equal(f.kind, 'convention');
  assert.doesNotMatch(f.message, /\/tmp\/x|at harness|22 \|/);
  assert.match(f.message, /do not file a product bug for this\.$/);
});

test('messages are capped', () => {
  const f = classifyFailure('x'.repeat(50_000), {});
  assert.ok(f.message.length < 3_200);
});

test('Playwright\'s report becomes pass / fail / not-run tests with the failure classified', () => {
  const dir = project();
  const { specs } = resolveSpecs(dir, 'jobs');
  const gen = specs.find((s) => s.area === 'generated');
  const report = oneSpec(specs, `generated/${gen.name}`, [
    { title: 'Happy path', status: 'expected', result: 'passed' },
    { title: 'Broken', status: 'unexpected', result: 'failed', error: HARNESS_TEXT },
    { title: 'Needs a fixture', status: 'skipped', result: 'skipped', annotations: [{ type: 'fixme', description: 'a fixture where the guard "x" holds' }] },
  ]);
  const tests = readReport(report, { specs, origin: 'http://localhost:3000' });
  assert.deepEqual(tests.map((t) => t.status), ['passed', 'failed', 'not-run']);
  assert.equal(tests[1].failure.kind, 'convention');
  assert.equal(tests[2].reason, 'a fixture where the guard "x" holds');
  assert.equal(tests[0].area, 'generated');
  assert.equal(tests[0].durationMs, 1234);
  const text = renderRunText({ ok: true, feature: 'jobs', baseUrl: 'http://localhost:3000', durationMs: 4200, counts: { passed: 1, failed: 1, notRun: 1, total: 3 }, tests });
  assert.match(text, /1 passed, 1 failed, 1 not run/);
  assert.match(text, /HARNESS PROBLEM, NOT A PRODUCT BUG/);
  assert.match(text, /Needs: a fixture where the guard/);
});

test('a run carries the bug-report text on an app failure and only there', async () => {
  const dir = project();
  const { specs } = resolveSpecs(dir, 'jobs');
  const gen = specs.find((s) => s.area === 'generated');
  const report = oneSpec(specs, `generated/${gen.name}`, [
    { title: 'Reached the wrong state', status: 'unexpected', result: 'failed', error: 'Expected string: "done"\nReceived string: "working"' },
    { title: 'Missing id', status: 'unexpected', result: 'failed', error: HARNESS_TEXT },
  ]);
  fakePlaywright(dir, { report });
  const r = await runFeatureTests(dir, 'jobs', { tmp: makeTempDir('construct-testrun-tmp-'), probe: async () => true });
  assert.equal(r.ok, true);
  assert.match(r.tests[0].failure.bugReport, /Actual: it reached "working"/);
  assert.equal(r.tests[1].failure.bugReport, undefined);
});

test('the run refuses cleanly, before anything starts: bad address, no Playwright, app not answering', async () => {
  const dir = project();
  assert.equal((await runFeatureTests(dir, 'jobs', { baseUrl: 'https://example.com' })).error.code, 'BAD_BASE_URL');
  assert.equal((await runFeatureTests(dir, 'nope')).error.code, 'NO_FEATURE');
  const none = await runFeatureTests(dir, 'jobs', { repo: dir, probe: async () => true });
  assert.equal(none.error.code, 'PLAYWRIGHT_MISSING');
  assert.match(none.error.message, /npx playwright install chromium/);
  fakePlaywright(dir, { report: { suites: [] } });
  const down = await runFeatureTests(dir, 'jobs', { probe: async () => false });
  assert.equal(down.error.code, 'APP_UNREACHABLE');
  assert.match(down.error.message, /Nothing answered at http:\/\/localhost:3000/);
  assert.match(down.error.message, /says nothing about the product/);
});

test('a run writes its throwaway config OUTSIDE the project, lists only files found on disk, uses no shell, and cleans up', async () => {
  const dir = project();
  const { specs } = resolveSpecs(dir, 'jobs');
  const gen = specs.find((s) => s.area === 'generated');
  const tmp = makeTempDir('construct-testrun-tmp-');
  const report = oneSpec(specs, `generated/${gen.name}`, [{ title: 'Happy path', status: 'expected', result: 'passed' }]);
  const sawFile = path.join(makeTempDir('construct-testrun-saw-'), 'saw.json');
  fakePlaywright(dir, { report, saw: sawFile });
  const before = fs.readdirSync(dir).sort();
  const r = await runFeatureTests(dir, 'jobs', { name: gen.name, area: 'generated', baseUrl: 'http://localhost:4567', tmp, probe: async () => true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.counts, { total: 1, passed: 1, failed: 0, notRun: 0 });
  assert.equal(r.baseUrl, 'http://localhost:4567');
  const saw = JSON.parse(fs.readFileSync(sawFile, 'utf8'));
  assert.deepEqual(saw.cfg.testMatch, [`generated/${gen.name}`], 'exactly the one file found on disk');
  assert.equal(saw.cfg.testDir, path.join(dir, 'features', 'jobs', 'tests'));
  assert.equal(saw.cfg.use.baseURL, 'http://localhost:4567');
  assert.equal(saw.cfg.workers, 1);
  assert.deepEqual(saw.argv.slice(0, 1), ['test'], 'an argv array: the only arguments are test --config <file>');
  assert.equal(saw.argv.length, 3);
  assert.ok(saw.cwd.startsWith(tmp), 'Playwright runs in the throwaway directory, not the project');
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'nothing was written inside the project');
  assert.deepEqual(fs.readdirSync(tmp), [], 'the temp directory is gone after the run');
});

test('cancelling stops Playwright and leaves no temp directory behind; a timeout does the same', async () => {
  const dir = project();
  fakePlaywright(dir, { sleep: true });
  const tmp = makeTempDir('construct-testrun-tmp-');
  const ac = new AbortController();
  const running = runFeatureTests(dir, 'jobs', { tmp, probe: async () => true, signal: ac.signal, onProgress: (l) => { if (/^Running/.test(l)) setTimeout(() => ac.abort(), 200); } });
  const r = await running;
  assert.equal(r.error.code, 'CANCELLED');
  assert.deepEqual(fs.readdirSync(tmp), []);
  const t = await runFeatureTests(dir, 'jobs', { tmp, probe: async () => true, timeoutMs: 300 });
  assert.equal(t.error.code, 'TIMEOUT');
  assert.deepEqual(fs.readdirSync(tmp), []);
  const pre = new AbortController();
  pre.abort();
  assert.equal((await runFeatureTests(dir, 'jobs', { tmp, probe: async () => true, signal: pre.signal })).error.code, 'CANCELLED');
});

test('reclaimRunsOf removes only the temp directories of the pid it is given', () => {
  const tmp = makeTempDir('construct-testrun-tmp-');
  const mine = path.join(tmp, `${RUN_DIR_PREFIX}4242-abc`);
  const other = path.join(tmp, `${RUN_DIR_PREFIX}4243-abc`);
  fs.mkdirSync(mine);
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(mine, 'playwright.pid'), '1');
  reclaimRunsOf(4242, { tmp });
  assert.equal(fs.existsSync(mine), false);
  assert.equal(fs.existsSync(other), true);
});

test('findPlaywright prefers the project\'s own, then the one Construct ships', () => {
  const root = makeTempDir('construct-testrun-pw-');
  const repo = makeTempDir('construct-testrun-repo-');
  assert.equal(findPlaywright(root, { repo }), null);
  const shipped = path.join(repo, 'ui', 'e2e', 'node_modules', '@playwright', 'test', 'cli.js');
  fs.mkdirSync(path.dirname(shipped), { recursive: true });
  fs.writeFileSync(shipped, '');
  assert.equal(findPlaywright(root, { repo }).cli, shipped);
  const own = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, '');
  assert.equal(findPlaywright(root, { repo }).cli, own);
});

// ---- #438: traces of failed runs ------------------------------------------------------------------------------

test('the throwaway config records a trace only for a failure, inside the run directory', () => {
  const text = configText({ testDir: '/t', baseURL: 'http://localhost:3000', outputDir: '/run/out', reportFile: '/run/report.json', files: ['a.spec.ts'] });
  assert.match(text, /trace: 'retain-on-failure'/);
  assert.match(text, /outputDir: "\/run\/out"/);
});

test('keepTraces keeps a small failure trace under a renamed directory and names it relative to the temp dir', () => {
  const tmp = makeTempDir('construct-trace-tmp-');
  const dir = path.join(tmp, `${RUN_DIR_PREFIX}77-abc`);
  fs.mkdirSync(path.join(dir, 'out', 'a-test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'out', 'a-test', 'trace.zip'), 'PK-small');
  const r = keepTraces(dir, { tmp });
  assert.equal(r.traces.length, 1);
  assert.ok(!path.isAbsolute(r.traces[0]) && !r.traces[0].includes('..'));
  assert.ok(r.traces[0].startsWith(`${TRACE_DIR_PREFIX}77-abc`));
  assert.ok(fs.existsSync(path.join(tmp, r.traces[0])));
  assert.equal(fs.existsSync(dir), false);
  reclaimRunsOf(77, { tmp }); // the crash backstop never touches a kept trace directory
  assert.ok(fs.existsSync(path.join(tmp, r.traces[0])));
});

test('keepTraces keeps nothing for a passing run and drops an oversized trace', () => {
  const tmp = makeTempDir('construct-trace-tmp-');
  const pass = path.join(tmp, `${RUN_DIR_PREFIX}78-abc`);
  fs.mkdirSync(path.join(pass, 'out'), { recursive: true });
  assert.deepEqual(keepTraces(pass, { tmp }), { keptDir: null, traces: [] });
  assert.ok(fs.existsSync(pass)); // removing it stays the caller's job
  const big = path.join(tmp, `${RUN_DIR_PREFIX}79-abc`);
  fs.mkdirSync(path.join(big, 'out', 't'), { recursive: true });
  const f = path.join(big, 'out', 't', 'trace.zip');
  fs.writeFileSync(f, '');
  fs.truncateSync(f, TRACE_MAX_FILE_BYTES + 1);
  assert.deepEqual(keepTraces(big, { tmp }), { keptDir: null, traces: [] });
  assert.equal(fs.existsSync(f), false);
});

test('pruneTraceDirs removes old directories and all but the newest few', () => {
  const tmp = makeTempDir('construct-trace-tmp-');
  const now = Date.now();
  const mk = (name, ageMs) => { const p = path.join(tmp, `${TRACE_DIR_PREFIX}${name}`); fs.mkdirSync(p); const t = new Date(now - ageMs); fs.utimesSync(p, t, t); return p; };
  const old = mk('old', 2 * 60 * 60 * 1000);
  const fresh = Array.from({ length: TRACE_KEEP_DIRS + 2 }, (_, i) => mk(`n${i}`, (i + 1) * 1000));
  const other = path.join(tmp, 'unrelated'); fs.mkdirSync(other);
  pruneTraceDirs({ tmp, now });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fresh.filter((p) => fs.existsSync(p)).length, TRACE_KEEP_DIRS);
  assert.ok(fs.existsSync(fresh[0]) && !fs.existsSync(fresh[fresh.length - 1]));
  assert.ok(fs.existsSync(other));
});
