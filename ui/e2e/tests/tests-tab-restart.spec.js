import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// #416 -- the failure mode this spec proves fixed: "after a restart, a finished Tests-tab run has a record but
// no result" (reviewAnalyses.mjs/testRuns.mjs's `createResults()`/`createRunResults()` were bounded IN-MEMORY
// Maps only). This spec runs against a REAL ui/server it spawns and kills itself (Playwright's own `webServer`
// starts a command once and stops it once -- it cannot restart mid-test), so the restart here is not simulated:
// the process is really gone and a really new one takes its place, reading the SAME on-disk state directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const BIN = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const SERVER_ENTRY = path.join(REPO, 'ui', 'server', 'src', 'index.mjs');
const SHOTS = path.resolve(__dirname, '../screenshots/tests-tab');
fs.mkdirSync(SHOTS, { recursive: true });

const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4000;
const API = process.env.E2E_API_BASE || `http://localhost:${SERVER_PORT}`;
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;

const BASE_YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LOCK_YML = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
const MACHINE = `import { setup } from 'xstate';
export const Simple = setup({}).createMachine({
  id: 'simple',
  initial: 'idle',
  states: { idle: { on: { START_JOB: 'working' } }, working: { on: { finishJob: 'done' } }, done: { type: 'final' } },
});
`;

/** A throwaway project with one feature ("jobs") and one generated (locked) scenario test, exactly like
 * ui/server/src/testRuns.test.mjs's fixture -- this spec only needs a run that finishes, not a feature to browse. */
function makeProject() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og416-tests-restart-')));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + LOCK_YML);
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), MACHINE);
  execFileSync('node', [BIN, 'generate', 'tests', 'jobs', '--dir', dir], { encoding: 'utf8' });
  return dir;
}

/** A stand-in Playwright inside the project (same technique as ui/server/src/testRuns.test.mjs's
 * `fakePlaywright`): this spec is proving a RESULT survives a restart, not re-proving a real Playwright run. */
function stubPlaywright(dir) {
  const gen = fs.readdirSync(path.join(dir, 'features', 'jobs', 'tests', 'generated')).sort()[0];
  const report = { suites: [{ title: gen, file: `generated/${gen}`, specs: [{ title: 'Happy path', file: `generated/${gen}`, tests: [{ status: 'expected', annotations: [], results: [{ status: 'passed', duration: 900, errors: [] }] }] }] }] };
  const cli = path.join(dir, 'node_modules', '@playwright', 'test', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, `const fs = require('fs');\nconst cfg = require(process.argv[process.argv.indexOf('--config') + 1]);\nfs.writeFileSync(cfg.reporter[0][1].outputFile, ${JSON.stringify(JSON.stringify(report))});\n`);
}

/** A tiny "app": the worker preflights the address before handing off to Playwright, so something has to answer. */
function startFakeApp() {
  const srv = http.createServer((_req, res) => res.end('ok'));
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

function waitForHealth(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error(`${url} never answered within ${timeoutMs}ms`));
      setTimeout(tick, 200);
    };
    tick();
  });
}

function startServer(env) {
  return spawn(process.execPath, [SERVER_ENTRY], { cwd: path.dirname(SERVER_ENTRY), env: { ...process.env, ...env }, stdio: 'pipe' });
}

/** SIGTERM, then SIGKILL after a grace period -- a real process death, not `server.close()` inside the same process. */
function stopServer(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    const hammer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 5000);
    hammer.unref();
  });
}

test.describe.serial('#416 -- a done Tests-tab run survives ui/server being restarted', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let dir;
  let stateDir;
  let app;
  let server;

  const serverEnv = () => ({
    PORT: String(SERVER_PORT),
    UI_CLIENT_ORIGIN: CLIENT_ORIGIN,
    CONSTRUCT_STATE_DIR: stateDir,
    CONSTRUCT_WORKSPACE_ROOT: fs.realpathSync(os.tmpdir()),
  });

  test.beforeAll(async () => {
    dir = makeProject();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og416-state-'));
    stubPlaywright(dir);
    app = await startFakeApp();
    server = startServer(serverEnv());
    await waitForHealth(`${API}/api/health`);
    await fetch(`${API}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectDir: dir }) });
  });

  test.afterAll(async () => {
    await stopServer(server);
    app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  test('a run finishes, the server is killed and a new one takes its place, and the Tests tab still shows it done', async ({ page }) => {
    const address = `http://127.0.0.1:${app.address().port}`;

    await gotoCockpit(page, '/tests');
    await page.getByTestId('run-address').fill(address);
    await page.getByTestId('run-all').click();
    await expect(page.getByTestId('run-done')).toContainText('passed', { timeout: 20_000 });
    await expect(page.getByTestId('run-result')).toHaveCount(1);
    await expect(page.getByTestId('run-result').first()).toHaveAttribute('data-status', 'passed');
    await page.screenshot({ path: path.join(SHOTS, '416-tests-tab-before-restart--dark.png') });

    // The restart: SIGTERM the real ui/server process (its in-memory results Map, testRuns.mjs's
    // createRunResults(), dies with it) and start a brand-new one against the SAME state directory.
    await stopServer(server);
    server = startServer(serverEnv());
    await waitForHealth(`${API}/api/health`);
    await fetch(`${API}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectDir: dir }) });

    // A fresh page load against the NEW process: the result must be read from processStore's
    // `saveAside('result', ...)` sidecar (#416), not from a Map that no longer exists.
    await page.reload();
    await gotoCockpit(page, '/tests');
    await expect(page.getByTestId('run-done')).toContainText('passed', { timeout: 20_000 });
    await expect(page.getByTestId('run-result')).toHaveCount(1);
    await expect(page.getByTestId('run-result').first()).toHaveAttribute('data-status', 'passed');
    await page.screenshot({ path: path.join(SHOTS, '416-tests-tab-after-restart--dark.png') });
  });
});
