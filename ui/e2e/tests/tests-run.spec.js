import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// #305 -- running the QA tests from the Cockpit, as a process. Nothing is mocked: the specs are written by the REAL
// generator from a real workflow, the Cockpit's server forks its real worker, which runs REAL Playwright in a REAL
// Chromium against a REAL (tiny) app started by this spec. The app is built to be wrong in the two ways a test can
// meet: one button has no data-testid (the test harness's problem, not the product's) and one button does not do what
// the flow says (the product's bug). The Tests tab has to tell them apart, in the generator's own words.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const BIN = path.join(REPO, 'bin', 'construct.mjs');
const SHOTS = path.resolve(__dirname, '../screenshots/tests-run');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const LOCK = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
const MACHINE = `import { setup } from 'xstate';
export const Jobs = setup({}).createMachine({
  id: 'jobs',
  initial: 'idle',
  states: {
    idle: { on: { START_JOB: 'working' } },
    working: { on: { FINISH_JOB: 'done', ABORT_JOB: 'aborted' } },
    done: { type: 'final' },
    aborted: { type: 'final' },
  },
});
`;
// a test QA wrote by hand: it passes against the app below
const MINE = `import { test, expect } from '@playwright/test';

test('QA: starting a job shows it as working', async ({ page }) => {
  await page.goto('/jobs');
  await page.getByTestId('start-job').click();
  await expect(page.locator('[data-flow="jobs"]')).toHaveAttribute('data-flow-state', 'working');
});
`;
// the app: start works; finish has NO data-testid (convention failure); abort has its id but does nothing (app failure)
const PAGE = `<!doctype html><html><body>
<main data-flow="jobs" data-flow-state="idle">
  <h1>Jobs</h1>
  <button data-testid="start-job" onclick="document.querySelector('[data-flow]').setAttribute('data-flow-state','working')">Start</button>
  <button onclick="document.querySelector('[data-flow]').setAttribute('data-flow-state','done')">Finish</button>
  <button data-testid="abort-job">Abort</button>
</main></body></html>`;

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og305-run-'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE + LOCK);
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Jobs.ts'), MACHINE);
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'controllers', 'JobsController.tsx'), 'export function JobsController() {\n  return <div />;\n}\n');
  fs.mkdirSync(path.join(dir, 'app', 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'jobs', 'page.tsx'), "import { JobsController } from '../../features/jobs/controllers/JobsController';\n\nexport default function Page() {\n  return <JobsController />;\n}\n");
  execFileSync('node', [BIN, 'generate', 'tests', 'jobs', '--dir', dir], { encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'tests', 'start-check.spec.ts'), MINE);
  return dir;
}
const leftovers = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('construct-testrun-'));

test.describe.serial('Running the QA tests from the Cockpit (#305)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  test.setTimeout(120_000);
  let originalDir;
  let dir;
  let app;
  let appUrl;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    dir = makeProject();
    app = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(req.url === '/jobs' ? PAGE : '<!doctype html><title>app</title>');
    });
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    appUrl = `http://127.0.0.1:${app.address().port}`;
    await request.post(`${API}/api/settings`, { data: { projectDir: dir } });
  });
  test.afterAll(async ({ request }) => {
    const list = await (await request.get(`${API}/api/processes`)).json();
    for (const p of list.processes ?? []) if (p.controls?.includes('CANCEL')) await request.post(`${API}/api/processes/${p.id}/cancel`);
    await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    await new Promise((r) => app.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an app that is not running is one clear message, not a wall of timeouts', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await expect(page.getByTestId('run-panel')).toBeVisible();
    await page.getByTestId('run-address').fill('http://127.0.0.1:1');
    await page.getByTestId('run-all').click();
    const problem = page.getByTestId('run-problem');
    await expect(problem).toBeVisible({ timeout: 30_000 });
    await expect(problem).toContainText('Your app is not running');
    await expect(problem).toContainText('Nothing answered at http://127.0.0.1:1');
    await expect(problem).toContainText('says nothing about the product');
    await expect(page.getByTestId('run-results')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, '305-app-not-running--dark.png') });
  });

  test('a hostile address is refused by the server before anything runs', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    for (const bad of ['https://example.com', 'http://user:pw@localhost:3000', 'http://localhost:3000/admin']) {
      await page.getByTestId('run-address').fill(bad);
      await page.getByTestId('run-all').click();
      await expect(page.getByTestId('run-refused')).toBeVisible();
      await expect(page.getByTestId('run-live')).toHaveCount(0);
    }
    await expect(page.getByTestId('run-refused')).toContainText(/plain http|only where the app runs|on this machine/i);
  });

  test('a run shows as running with Cancel, then reports each test; the two failures are told apart in words', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await page.getByTestId('run-address').fill(appUrl);
    await page.getByTestId('run-all').click();

    // running: announced in a live region, with Cancel, and the address cannot be changed under it
    const live = page.getByTestId('run-live');
    await expect(live).toBeVisible();
    await expect(live).toContainText('Running every test of jobs');
    await expect(page.getByTestId('run-cancel')).toBeVisible();
    await expect(page.getByTestId('run-address')).toBeDisabled();
    await expect(page.getByTestId('run-status')).toHaveAttribute('aria-live', 'polite');
    await page.screenshot({ path: path.join(SHOTS, '305-running--dark.png') });

    // it is a Process: it is in the Processes drawer while it runs
    await page.getByTestId('pill-processes').click();
    await expect(page.locator('[data-testid="process-row"][data-state="running"]').filter({ hasText: 'Run every test of jobs' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '305-in-processes-drawer--dark.png') });
    await page.keyboard.press('Control+j'); // put the drawer away again

    await expect(page.getByTestId('run-done')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('run-done')).toContainText('1 passed · 2 failed · 0 not run');
    const rows = page.getByTestId('run-result');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('[data-testid="run-result"][data-status="passed"]')).toContainText('Passed');
    await expect(page.locator('[data-testid="run-result"][data-status="failed"]')).toHaveCount(2);
    // symbol AND word, never colour alone
    await expect(page.locator('[data-testid="run-result"][data-status="failed"]').first()).toContainText('✗ Failed');

    // CONVENTION failure: the harness's problem, in the generator's own words, and NOT offered as a bug
    const convention = page.getByTestId('failure-convention');
    await expect(convention).toBeVisible();
    await expect(convention).toContainText('Harness problem, not a product bug');
    await expect(convention.getByTestId('failure-selector')).toHaveText('[data-testid="finish-job"]');
    await expect(convention.getByTestId('failure-step')).toContainText('Step');
    await expect(convention.getByTestId('failure-page')).toContainText(`${appUrl}/jobs`);
    const said = await convention.getByTestId('failure-message').innerText();
    expect(said).toContain('Test harness problem, not a bug in the page: the test harness expected [data-testid="finish-job"]');
    expect(said).toContain('data-testid = the event name in kebab-case');
    expect(said).toContain('do not file a product bug for this');
    expect(said).not.toMatch(/waiting for locator|element not found/i);
    await expect(convention.getByTestId('failure-fix')).toContainText('architecture.yml');
    await expect(convention.getByRole('button', { name: /bug report/i })).toHaveCount(0);
    await convention.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, '305-convention-failure--dark.png') });

    // APP failure: what was expected, what was reached, and it IS offered as a bug report
    const app = page.getByTestId('failure-app');
    await expect(app).toBeVisible();
    await expect(app).toContainText('The app behaved differently');
    await expect(app.getByTestId('failure-summary')).toHaveText('Expected the flow to reach "aborted", it reached "working".');
    await expect(app.getByTestId('copy-bug-report')).toBeVisible();
    await page.evaluate(() => document.querySelector('[data-testid="tests-stage"]').closest('main, section, div[style*="overflow"], div')?.scrollTo?.(0, 0));
    await page.getByTestId('run-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, '305-failures-told-apart--dark.png'), fullPage: false });

    // the coverage table's "Last result" column carries the same words
    await expect(page.locator('[data-testid="last-result"][data-status="passed"], [data-testid="last-result"][data-status="failed"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="last-result"][data-status="failed"]')).toHaveCount(2);

    // Copy as bug report: real clipboard, real text
    await app.getByTestId('copy-bug-report').click();
    await expect(app.getByTestId('copied')).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Bug: ');
    expect(clip).toContain('Feature: jobs');
    expect(clip).toContain('Expected: the flow reaches "aborted"');
    expect(clip).toContain('Actual: it reached "working"');
    expect(clip).toContain(`Page: ${appUrl}/jobs`);
    await expect(app.getByTestId('bug-report-text')).toContainText('Actual: it reached "working"');
    await page.screenshot({ path: path.join(SHOTS, '305-bug-report-copied--dark.png') });

    // accessible: no blocking violation on the run panel and its results (the stage). The Processes drawer, open here, is
    // scanned by its own spec; it has an existing contrast finding on its "Done" label that is not part of this change.
    const scan = await runAxe(page, { include: '[data-testid="tests-stage"]' });
    expect(scan.filter(isBlocking), format(scan)).toEqual([]);

    // the run left nothing behind, and the project's files are exactly what they were
    await expect.poll(leftovers, { timeout: 15_000 }).toEqual([]);
    expect(fs.readdirSync(dir).sort()).toEqual(['app', 'architecture.yml', 'features']);
    expect(fs.existsSync(path.join(dir, 'test-results'))).toBe(false);
  });

  test('one test: its detail shows the outcome and the same explanation; "Run this test" runs only it', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await page.getByTestId('run-address').fill(appUrl);
    // pick the QA-written test that passes
    await page.getByTestId('tree-yours').filter({ hasText: 'start-check' }).click();
    await expect(page.getByTestId('detail-run')).toBeEnabled();
    await expect(page.getByTestId('detail-last-run')).toContainText('✓ Passed');
    await page.getByTestId('detail-run').click();
    // only this one test ran: the latest run's summary says 1 test, not 3
    await expect(page.getByTestId('run-live')).toBeVisible();
    await expect(page.getByTestId('run-done')).toContainText('1 passed · 0 failed · 0 not run', { timeout: 90_000 });
    await expect(page.getByTestId('detail-last-run')).toContainText('✓ Passed');
    // the others keep their previous results; the failing generated test explains itself in the Tools pane too
    await page.getByTestId('run-result').filter({ hasText: 'Happy path' }).getByRole('button').click();
    await expect(page.getByTestId('detail-last-run')).toContainText('✗ Failed');
    await expect(page.getByTestId('detail-failure-convention')).toBeVisible();
    await expect(page.getByTestId('detail-failure-selector')).toHaveText('[data-testid="finish-job"]');
    const tools = await runAxe(page, { include: '[data-testid="test-detail"]' });
    expect(tools.filter(isBlocking), format(tools)).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, '305-one-test-detail--dark.png') });
  });

  test('cancel stops a run that is in flight: Playwright is gone, nothing is left, and the drawer says Cancelled', async ({ page, request }) => {
    await gotoCockpit(page, '/tests');
    await page.getByTestId('run-address').fill(appUrl);
    await page.getByTestId('run-all').click();
    await expect(page.getByTestId('run-live')).toBeVisible();
    // Playwright is really running: its temp directory holds the pid
    let pid = null;
    await expect.poll(() => {
      const d = leftovers().find((n) => fs.existsSync(path.join(os.tmpdir(), n, 'playwright.pid')));
      if (d) pid = Number(fs.readFileSync(path.join(os.tmpdir(), d, 'playwright.pid'), 'utf8'));
      return pid;
    }, { timeout: 30_000 }).not.toBeNull();
    expect(() => process.kill(pid, 0)).not.toThrow();
    await page.getByTestId('run-cancel').click();
    const problem = page.getByTestId('run-problem');
    await expect(problem).toContainText('The run was cancelled', { timeout: 30_000 });
    await expect(page.getByTestId('run-live')).toHaveCount(0);
    await expect(page.getByTestId('run-all')).toBeEnabled();
    await expect.poll(() => { try { process.kill(pid, 0); return true; } catch { return false; } }, { timeout: 15_000 }).toBe(false);
    await expect.poll(leftovers, { timeout: 15_000 }).toEqual([]);
    const list = (await (await request.get(`${API}/api/processes`)).json()).processes;
    const cancelled = list.filter((p) => /Run every test of jobs/.test(p.title) && p.state === 'cancelled');
    expect(cancelled.length).toBeGreaterThan(0);
    const detail = (await (await request.get(`${API}/api/processes/${cancelled[0].id}`)).json()).process;
    expect(detail.artifacts).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, '305-cancelled--dark.png') });
  });
});
