// #305 -- run a feature's Playwright tests and say WHAT KIND of failure each one is. Deterministic, no LLM, no `ui/`
// imports; the Cockpit's "Run" button, `construct test run` and a plan step (flow `test.run`) are this one block.
//
// What a run is: an argv-array spawn of the project's own Playwright (never a shell) with a THROWAWAY config written to a
// fresh temp directory, so the project tree is never written to. The config lists the exact spec files this module found
// on disk itself; no caller string is ever a path, a glob or an argument. The app under test must already be running
// (the tests drive the project's own app); a preflight says so plainly instead of letting every test time out.
//
// Failure kinds, in the generator's own wording (testSpecRender.mjs HELPERS):
//   convention  the harness could not find the element/attribute the flow binds to. NOT a product bug.
//   app         the element was found, the flow reached another state than the test expected. A bug worth reporting.
//   other       anything else (a page that did not open, a timeout): shown verbatim, never called a product bug.
//
// Cancelling: `signal` (or a timeout) stops Playwright's whole process group, SIGTERM then SIGKILL after a grace period,
// and removes the temp directory. `reclaimRunsOf(pid)` is the parent's backstop when the caller itself was killed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locate, readRegular } from './testClone.mjs';
import { describeSteps, parseSpecRaw } from './testSteps.mjs';
import { GENERATED_MARKER } from './testGenerator.mjs';

export const RUN_TIMEOUT_MS = 180_000;
export const KILL_GRACE_MS = 1_500;
export const MAX_SPECS = 200;
export const MAX_TESTS = 500;
export const MAX_OUTPUT = 200_000;
const MAX_MESSAGE = 3_000;
const PER_TEST_TIMEOUT_MS = 30_000;
const PROBE_MS = 3_000;
export const DEFAULT_BASE_URL = 'http://localhost:3000';
export const RUN_DIR_PREFIX = 'construct-testrun-';
const GENERATED_RE = /^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*\.spec\.ts$/;
const YOURS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.spec\.ts$/;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const clean = (s) => String(s ?? '').replace(ANSI, '').replace(/\r/g, '');
const clip = (s, n = MAX_MESSAGE) => (s.length > n ? `${s.slice(0, n)}\n... (${s.length - n} more characters not shown)` : s);

// ---- the app's address -------------------------------------------------------------------------------------------

/**
 * The origin the tests drive. Only a plain http(s) origin on THIS machine: a run may not be pointed at a third party,
 * carry credentials, or smuggle a path or query. -> { ok, origin } | { ok:false, error }
 */
export function parseBaseUrl(value) {
  const raw = value === undefined || value === null || value === '' ? DEFAULT_BASE_URL : value;
  if (typeof raw !== 'string' || raw.length > 200 || /[\0-\x1f\x7f\s]/.test(raw)) return fail('BAD_BASE_URL', 'The address of the app must be a plain http:// address, like http://localhost:3000.');
  let u;
  try { u = new URL(raw); } catch { return fail('BAD_BASE_URL', `"${raw.slice(0, 80)}" is not an address. Use one like http://localhost:3000.`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('BAD_BASE_URL', 'The address of the app must start with http:// or https://.');
  if (u.username || u.password) return fail('BAD_BASE_URL', 'The address of the app must not contain a user name or password.');
  if (u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return fail('BAD_BASE_URL', 'Give only where the app runs (for example http://localhost:3000), not a page; each test knows its own page.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host))) {
    return fail('BAD_BASE_URL', 'Tests run only against an app on this machine (localhost or 127.0.0.1), never a remote address.');
  }
  return { ok: true, origin: u.origin };
}

/** Is anything answering at `origin`? Any HTTP answer counts (a 404 still means the app is up). */
export function probeApp(origin, { timeoutMs = PROBE_MS } = {}) {
  return new Promise((resolve) => {
    const lib = origin.startsWith('https:') ? https : http;
    const req = lib.request(origin, { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false }, (res) => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

// ---- which specs ------------------------------------------------------------------------------------------------

/**
 * The specs a run covers, found by reading the feature's own tests directories (never from the caller's string).
 * `name` (optional) is only COMPARED with what is on disk; `area` says which directory it belongs in.
 * -> { ok, testsDir, specs:[{ name, area, rel, text }] } | { ok:false, error }
 */
export function resolveSpecs(root, feature, { name, area } = {}) {
  const at = locate(root, feature);
  if (!at.ok) return fail(at.code === 'no-feature' ? 'NO_FEATURE' : 'BAD_TARGET', at.error);
  const list = (dir, re, areaName, marker) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.filter((n) => re.test(n)).sort().map((n) => ({ name: n, area: areaName, rel: areaName === 'generated' ? `generated/${n}` : n, text: readRegular(path.join(dir, n)) }))
      .filter((f) => f.text !== null && (!marker || f.text.startsWith(`${marker}\n`)));
  };
  const all = [...list(at.genDir, GENERATED_RE, 'generated', GENERATED_MARKER), ...list(at.testsDir, YOURS_RE, 'yours', null)];
  if (name === undefined || name === null || name === '') {
    if (!all.length) return fail('NO_TESTS', `Feature "${feature}" has no tests to run yet. Generate them first.`);
    if (all.length > MAX_SPECS) return fail('TOO_MANY', `A run covers at most ${MAX_SPECS} test files; this feature has ${all.length}.`);
    return { ok: true, testsDir: at.testsDir, specs: all };
  }
  if (typeof name !== 'string' || (area !== 'generated' && area !== 'yours')) return fail('BAD_TARGET', 'A single test is named by its file name and whether it is generated or yours.');
  const one = all.find((s) => s.area === area && s.name === name);
  return one ? { ok: true, testsDir: at.testsDir, specs: [one] } : fail('NOT_FOUND', `There is no ${area === 'generated' ? 'generated' : 'your'} test "${name.slice(0, 80)}" in feature "${feature}".`);
}

// ---- Playwright ------------------------------------------------------------------------------------------------

/** The project's own Playwright, else the one Construct itself ships for its tests. -> { cli, modules } | null */
export function findPlaywright(root, { repo = REPO } = {}) {
  const modules = [path.join(root, 'node_modules'), path.join(repo, 'ui', 'e2e', 'node_modules'), path.join(repo, 'node_modules')];
  for (const m of modules) {
    const cli = path.join(m, '@playwright', 'test', 'cli.js');
    if (fs.existsSync(cli)) return { cli, modules: m };
  }
  return null;
}

const configText = ({ testDir, baseURL, outputDir, reportFile, files }) => `module.exports = {
  testDir: ${JSON.stringify(testDir)},
  testMatch: ${JSON.stringify(files)},
  outputDir: ${JSON.stringify(outputDir)},
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: ${PER_TEST_TIMEOUT_MS},
  reporter: [['json', { outputFile: ${JSON.stringify(reportFile)} }]],
  use: { baseURL: ${JSON.stringify(baseURL)}, headless: true, screenshot: 'off', video: 'off', trace: 'off' },
};
`;

const SAFE_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'DISPLAY', 'PLAYWRIGHT_BROWSERS_PATH', 'XDG_CACHE_HOME', 'SystemRoot', 'LOCALAPPDATA'];
function childEnv(modules) {
  const env = { FORCE_COLOR: '0', NO_COLOR: '1', NODE_PATH: modules, CI: '1' };
  for (const k of SAFE_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

// ---- reading a failure ------------------------------------------------------------------------------------------

const HARNESS = /Test harness problem, not a bug in the page: the test harness expected (.+?)\. (.*?) Construct binds workflow events/s;
const EVENT_OF = /the workflow event (\S+) binds to/;
const START_URL = /^const START_URL: string \| null = (.*);$/m;
const STATE_ASSERT = /Expected(?: string)?: "([^"\n]*)"\s*\n\s*Received(?: string)?: "([^"\n]*)"/;

function startPath(text) {
  const m = START_URL.exec(text);
  try { const v = m && JSON.parse(m[1]); return typeof v === 'string' ? v : null; } catch { return null; }
}

/** Which step of the test (1-based, in the words the Steps view uses) a failure belongs to, when it can be told. */
function stepOf(specText, pick) {
  const raw = parseSpecRaw(specText);
  if (!raw.ok) return null;
  const steps = describeSteps(raw.doc.steps);
  const i = steps.findIndex(pick);
  return i < 0 ? null : { n: i + 1, sentence: steps[i].sentence };
}

/**
 * One failure message -> { kind, ... }. Convention failures keep the generator's own sentence; nothing is paraphrased
 * into "element not found".
 */
export function classifyFailure(rawMessage, { specText = '', origin = '' } = {}) {
  const message = clip(clean(rawMessage).replace(/^\s*Error: /, '').trim());
  const h = HARNESS.exec(message);
  if (h) {
    const selector = h[1];
    const why = h[2];
    const event = EVENT_OF.exec(why)?.[1] ?? null;
    const step = stepOf(specText, event ? (s) => s.kind === 'event' && s.event === event : (s) => s.kind === 'state');
    const route = startPath(specText);
    return {
      kind: 'convention',
      title: 'Harness problem, not a product bug',
      message,
      selector,
      event,
      why,
      step,
      page: route ? `${origin}${route}` : origin || null,
      fix: 'Add the attribute to the element (Construct emits it for what it scaffolds), or override the binding in architecture.yml. Do not file a product bug for this.',
    };
  }
  const s = STATE_ASSERT.exec(message);
  if (s) {
    const [, expected, reached] = s;
    const step = stepOf(specText, (x) => x.kind === 'state' && x.state === expected);
    return { kind: 'app', title: 'The app behaved differently', message, expected, reached, step, summary: `Expected the flow to reach "${expected}", it reached "${reached}".`, page: startPath(specText) ? `${origin}${startPath(specText)}` : origin || null };
  }
  return { kind: 'other', title: 'The test could not finish', message, step: null };
}

// ---- reading Playwright's report --------------------------------------------------------------------------------

function* walk(suite, file) {
  const f = suite.file || file;
  for (const spec of suite.specs ?? []) yield { spec, file: spec.file || f };
  for (const child of suite.suites ?? []) yield* walk(child, f);
}

/** Playwright's JSON report -> the tests, classified. Pure. */
export function readReport(report, { specs, origin }) {
  const byRel = new Map(specs.map((s) => [s.rel, s]));
  const tests = [];
  for (const top of report?.suites ?? []) {
    for (const { spec, file } of walk(top, top.file)) {
      const rel = String(file || '').replace(/\\/g, '/');
      const meta = byRel.get(rel);
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        const skipped = t.status === 'skipped' || last?.status === 'skipped';
        const passed = !skipped && (t.status === 'expected' || t.status === 'flaky') && last?.status === 'passed';
        const err = last?.errors?.[0]?.message ?? last?.error?.message ?? '';
        const out = {
          file: meta?.name ?? path.basename(rel),
          area: meta?.area ?? (rel.startsWith('generated/') ? 'generated' : 'yours'),
          title: spec.title,
          status: skipped ? 'not-run' : passed ? 'passed' : 'failed',
          durationMs: Math.round(last?.duration ?? 0),
        };
        if (skipped) out.reason = clean(t.annotations?.find((a) => a.type === 'fixme')?.description ?? '').slice(0, 500) || null;
        if (out.status === 'failed') out.failure = classifyFailure(err || (last?.status === 'timedOut' ? `The test took longer than ${PER_TEST_TIMEOUT_MS / 1000} seconds and was stopped.` : 'The test failed without a message.'), { specText: meta?.text ?? '', origin });
        tests.push(out);
        if (tests.length >= MAX_TESTS) return tests;
      }
    }
  }
  return tests;
}

const countOf = (tests) => ({ total: tests.length, passed: tests.filter((t) => t.status === 'passed').length, failed: tests.filter((t) => t.status === 'failed').length, notRun: tests.filter((t) => t.status === 'not-run').length });

// ---- the run itself ---------------------------------------------------------------------------------------------

function killGroup(pid, sig) {
  try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* already gone */ } }
}

/** Remove the debris of runs started by `pid` (its temp directories) and stop a Playwright it left behind. */
export function reclaimRunsOf(pid, { tmp = os.tmpdir() } = {}) {
  let names = [];
  try { names = fs.readdirSync(tmp); } catch { return; }
  for (const n of names) {
    if (!n.startsWith(`${RUN_DIR_PREFIX}${pid}-`)) continue;
    const dir = path.join(tmp, n);
    try {
      const child = Number(fs.readFileSync(path.join(dir, 'playwright.pid'), 'utf8'));
      // only a process that really is a Playwright of ours: the pid file lives in a directory named for the caller's pid
      if (Number.isInteger(child) && child > 1 && /playwright/.test(fs.readFileSync(`/proc/${child}/cmdline`, 'utf8'))) killGroup(child, 'SIGKILL');
    } catch { /* no pid file / not Linux / already gone */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * Run a feature's tests (all of them, or the one `name`/`area` names) against the app at `baseUrl`.
 * @param {string} root the project root
 * @param {string} feature
 * @param {{name?:string, area?:'generated'|'yours', baseUrl?:string, signal?:AbortSignal, timeoutMs?:number, onProgress?:(line:string)=>void, probe?:Function, tmp?:string, repo?:string}} [opts]
 * @returns {Promise<{ok:true, feature:string, baseUrl:string, durationMs:number, counts:object, tests:object[]} | {ok:false, error:{code:string,message:string}}>}
 * Never rejects. Nothing is written inside the project.
 */
export async function runFeatureTests(root, feature, { name, area, baseUrl, signal, timeoutMs = RUN_TIMEOUT_MS, onProgress, probe = probeApp, tmp = os.tmpdir(), repo = REPO } = {}) {
  const say = (line) => { try { onProgress?.(line); } catch { /* a listener must not stop the run */ } };
  if (signal?.aborted) return fail('CANCELLED', 'The run was cancelled before it started.');
  const address = parseBaseUrl(baseUrl ?? process.env.CONSTRUCT_TEST_BASE_URL);
  if (!address.ok) return address;
  const found = resolveSpecs(root, feature, { name, area });
  if (!found.ok) return found;
  const pw = findPlaywright(root, { repo });
  if (!pw) return fail('PLAYWRIGHT_MISSING', 'Playwright is not installed for this project. Install it once with: npm install -D @playwright/test && npx playwright install chromium');
  say(`Checking that the app answers at ${address.origin}`);
  if (!(await probe(address.origin))) {
    return fail('APP_UNREACHABLE', `Nothing answered at ${address.origin}. Start the project's app (for example with "npm run dev") and run the tests again. No test ran, so this says nothing about the product.`);
  }
  if (signal?.aborted) return fail('CANCELLED', 'The run was cancelled.');

  const dir = fs.mkdtempSync(path.join(tmp, `${RUN_DIR_PREFIX}${process.pid}-`));
  const reportFile = path.join(dir, 'report.json');
  const configFile = path.join(dir, 'playwright.config.cjs');
  fs.writeFileSync(configFile, configText({ testDir: found.testsDir, baseURL: address.origin, outputDir: path.join(dir, 'out'), reportFile, files: found.specs.map((s) => s.rel) }));
  const started = Date.now();
  say(`Running ${found.specs.length} test file${found.specs.length === 1 ? '' : 's'} in Chromium (one at a time)`);

  return new Promise((resolve) => {
    // argv array, no shell; own process group so the whole browser tree can be stopped together
    const child = spawn(process.execPath, [pw.cli, 'test', '--config', configFile], { cwd: dir, env: childEnv(pw.modules), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    try { fs.writeFileSync(path.join(dir, 'playwright.pid'), String(child.pid)); } catch { /* the reclaim backstop is best effort */ }
    let output = '';
    const take = (d) => { if (output.length < MAX_OUTPUT) output += d; };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    let settled = false;
    let stopping = null;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killer);
      signal?.removeEventListener('abort', onAbort);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the parent reclaims it */ }
      resolve(result);
    };
    let killer;
    const stop = (why) => {
      if (stopping) return;
      stopping = why;
      killGroup(child.pid, 'SIGTERM');
      killer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), KILL_GRACE_MS);
    };
    const onAbort = () => stop('CANCELLED');
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (e) => done(fail('RUN_FAILED', `Playwright could not be started: ${String(e.message || e)}`)));
    child.once('close', (code) => {
      // whatever the group still holds (a browser) goes with it
      killGroup(child.pid, 'SIGKILL');
      if (stopping === 'CANCELLED') return done(fail('CANCELLED', 'The run was cancelled.'));
      if (stopping === 'TIMEOUT') return done(fail('TIMEOUT', `The run took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
      let report = null;
      try { report = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch { /* no report */ }
      if (!report) {
        const text = clean(output).trim();
        const missing = /Executable doesn't exist|npx playwright install/.test(text);
        return done(fail(missing ? 'BROWSERS_MISSING' : 'RUN_FAILED', missing ? 'Playwright cannot find its browser. Install it once with: npx playwright install chromium' : `Playwright stopped without a report (exit ${code}). ${clip(text, 800)}`));
      }
      const tests = readReport(report, { specs: found.specs, origin: address.origin });
      if (!tests.length) return done(fail('RUN_FAILED', `Playwright ran but reported no tests. ${clip(clean(output).trim(), 800)}`));
      return done({ ok: true, feature, baseUrl: address.origin, durationMs: Date.now() - started, counts: countOf(tests), tests });
    });
  });
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** A finished run as text for a terminal (`construct test run`). Every failure keeps the words its kind was given above. */
export function renderRunText(result) {
  if (!result.ok) return result.error.message;
  const c = result.counts;
  const lines = [`Feature "${result.feature}": ${c.passed} passed, ${c.failed} failed, ${c.notRun} not run (${seconds(result.durationMs)}) against ${result.baseUrl}`];
  for (const t of result.tests) {
    const tag = t.status === 'passed' ? 'PASS   ' : t.status === 'failed' ? 'FAIL   ' : 'NOT RUN';
    lines.push(`  ${tag} ${t.title} (${t.file}, ${seconds(t.durationMs)})`);
    if (t.status === 'not-run' && t.reason) lines.push(`          Needs: ${t.reason}`);
    const f = t.failure;
    if (!f) continue;
    if (f.kind === 'convention') {
      lines.push(`          HARNESS PROBLEM, NOT A PRODUCT BUG${f.step ? ` (step ${f.step.n}: ${f.step.sentence})` : ''}`);
      lines.push(`          ${f.message.split('\n')[0]}`);
      lines.push(`          Fix: ${f.fix}`);
    } else if (f.kind === 'app') {
      lines.push(`          APP BEHAVED DIFFERENTLY${f.step ? ` (step ${f.step.n}: ${f.step.sentence})` : ''}: ${f.summary}`);
    } else {
      lines.push(`          COULD NOT FINISH: ${f.message.split('\n')[0]}`);
    }
  }
  return lines.join('\n');
}

// ---- Copy as bug report ----------------------------------------------------------------------------------------

/** Plain text a person can paste into a ticket, for an APP failure (the only kind that is a product bug). -> string | null */
export function bugReportText({ feature, baseUrl, test }) {
  const f = test?.failure;
  if (!f || f.kind !== 'app') return null;
  return [
    `Bug: ${test.title}`,
    '',
    `Feature: ${feature}`,
    `Test: ${test.file} (${test.area === 'generated' ? 'generated by Construct' : 'written by QA'})`,
    f.page || baseUrl ? `Page: ${f.page || baseUrl}` : null,
    f.step ? `Step ${f.step.n}: ${f.step.sentence}` : null,
    `Expected: the flow reaches "${f.expected}"`,
    `Actual: it reached "${f.reached}"`,
    '',
    'Found by an automated test that drives the app through the workflow. The test found its buttons and pages, so this is not a test setup problem.',
  ].filter((l) => l !== null).join('\n');
}
