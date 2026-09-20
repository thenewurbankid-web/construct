import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// #306 -- every state of the Tests tab that is not the happy path, above all the STALE CLONE: the flow a clone was made
// from changed, and Construct says so, deterministically, with what changed. Nothing is mocked except one deliberately
// marked response (the browsers cache of the machine the spec runs on): the specs are written by the REAL generator
// (`construct generate tests`) from the real refund-request workflow, the workflow SOURCE is then edited on disk, the
// tests are regenerated, and the verdict comes from the real comparison in src/engine/testFreshness.mjs.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const BIN = path.join(REPO, 'bin', 'construct.mjs');
const SHOTS = path.resolve(__dirname, '../screenshots/tests-states');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const LOCK = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
const REFUND = fs.readFileSync(path.join(REPO, 'fixtures/workflow-graphs/refund-request.ts'), 'utf8');
// the same workflow with ONE added transition: a refund is now audited before it is closed
const AUDITED = REFUND.replace("refunded: {\n      on: { CLOSE: 'closed' },\n    },", "refunded: {\n      on: { CLOSE: 'audit' },\n    },\n    audit: {\n      on: { SIGN_OFF: 'closed' },\n    },");
const NO_MACHINE = "import { setup } from 'xstate';\n\n// a machine with no initial state: Construct cannot enumerate scenarios from it\nexport const Broken = setup({}).createMachine({ id: 'broken', states: { a: {} } });\n";

function makeProject({ lock = true, source = REFUND } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og306-states-'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE + (lock ? LOCK : ''));
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'refunds', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'workflows', 'RefundRequest.ts'), source);
  return dir;
}
const generate = (dir) => execFileSync('node', [BIN, 'generate', 'tests', 'refunds', '--dir', dir, '--prune'], { encoding: 'utf8' });
const flow = (dir) => path.join(dir, 'features', 'refunds', 'workflows', 'RefundRequest.ts');

test.describe.serial('Tests tab states (#306)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let originalDir;
  const dirs = [];

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
  });
  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });
  const open = async (request, dir) => {
    dirs.push(dir);
    await request.post(`${API}/api/settings`, { data: { projectDir: dir } });
  };

  test('a clone whose flow changed is flagged stale with the diff; an unaffected clone and every locked test are not', async ({ page, request }) => {
    const dir = makeProject();
    generate(dir);
    const gen = path.join(dir, 'features', 'refunds', 'tests', 'generated');
    const tests = path.join(dir, 'features', 'refunds', 'tests');
    const happy = fs.readdirSync(gen).sort().find((f) => /happy-path/.test(f));
    const rejected = fs.readdirSync(gen).sort().find((f) => /ends-rejected/.test(f));
    await open(request, dir);
    for (const [source, name] of [[happy, 'happy-copy'], [rejected, 'rejected-copy']]) {
      const r = await request.post(`${API}/api/tests/refunds/clone`, { data: { source, name } });
      expect((await r.json()).ok, `clone ${name}`).toBe(true);
    }

    // BEFORE the flow changes: nothing is flagged
    await gotoCockpit(page, '/tests');
    await expect(page.getByTestId('tree-yours')).toHaveCount(2);
    await expect(page.getByTestId('stale-overview')).toHaveCount(0);
    await expect(page.getByTestId('chip-clone-stale')).toHaveCount(0);

    // the flow changes on disk (one added transition) and the tests are regenerated
    fs.writeFileSync(flow(dir), AUDITED);
    generate(dir);
    const cloneBefore = fs.readFileSync(path.join(tests, 'happy-copy.spec.ts'), 'utf8');
    const rejectedBefore = fs.readFileSync(path.join(tests, 'rejected-copy.spec.ts'), 'utf8');

    await gotoCockpit(page, '/tests');
    const overview = page.getByTestId('stale-overview');
    await expect(overview).toBeVisible();
    await expect(overview).toContainText('1 of your clone may be out of date');
    await expect(overview).toContainText('Review happy-copy');
    await expect(overview).not.toContainText('rejected-copy');
    await expect(page.getByTestId('chip-clone-stale')).toHaveCount(1);
    await expect(page.getByTestId('chip-clone-stale').first()).toContainText('Clone out of date');
    const tree = page.getByTestId('tree-yours');
    await expect(tree.filter({ hasText: 'happy-copy' })).toContainText('out of date');
    await expect(tree.filter({ hasText: 'rejected-copy' })).not.toContainText('out of date');
    // locked generated tests are never flagged as stale clones
    await expect(page.getByTestId('tree-generated').filter({ hasText: 'out of date' })).toHaveCount(0);

    await overview.getByTestId('stale-open').click();
    const banner = page.getByTestId('stale-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Possibly out of date');
    await expect(banner.getByTestId('stale-summary')).toContainText('The flow this test was cloned from has changed');
    const changes = banner.getByTestId('stale-change');
    await expect(changes.first()).toBeVisible();
    const said = (await changes.allTextContents()).join('\n');
    expect(said).toContain('"sign off" happens');
    expect(said).toContain('the flow moves to audit');
    await expect(banner.getByTestId('stale-next')).toContainText('Nothing was changed for you');
    await expect(page.getByTestId('detail-edit-steps')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '306-stale-clone--dark.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);

    // the unaffected clone: only a quiet note, no warning
    await tree.filter({ hasText: 'rejected-copy' }).click();
    await expect(page.getByTestId('clone-note')).toContainText('The flow changed elsewhere');
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);

    // "It is still fine" hides the note for this visit; nothing on disk changes
    await tree.filter({ hasText: 'happy-copy' }).click();
    await page.getByTestId('stale-dismiss').click();
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
    await expect(page.getByTestId('stale-dismissed')).toBeVisible();

    // a stale clone is NEVER rewritten
    expect(fs.readFileSync(path.join(tests, 'happy-copy.spec.ts'), 'utf8')).toBe(cloneBefore);
    expect(fs.readFileSync(path.join(tests, 'rejected-copy.spec.ts'), 'utf8')).toBe(rejectedBefore);
  });

  test('no tests yet: the empty state offers Generate, and the refusal and YAML are plain when the lock is not declared', async ({ page, request }) => {
    const dir = makeProject({ lock: true });
    await open(request, dir);
    await gotoCockpit(page, '/tests');
    const empty = page.getByTestId('state-empty');
    await expect(empty).toContainText('No tests for this feature yet');
    await expect(empty).toContainText('9 ways');
    await expect(empty.getByTestId('empty-generate')).toHaveText('Generate 9 tests');
    await expect(empty.getByTestId('empty-new')).toBeDisabled();
    await expect(empty).toContainText('not available yet');
    await page.screenshot({ path: path.join(SHOTS, '306-empty--dark.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);

    // no lock declared in architecture.yml: the generator's own refusal, with the exact YAML
    const bare = makeProject({ lock: false });
    await open(request, bare);
    await gotoCockpit(page, '/tests');
    await expect(page.getByTestId('lock-missing')).toContainText('frozen:');
    await page.getByTestId('empty-generate').click();
    const refused = page.getByTestId('generate-refused');
    await expect(refused).toContainText('Refusing to generate tests');
    await expect(refused).toContainText('features/*/tests/generated/**');
    await expect(refused).toContainText('nonLayer:');
    expect(fs.existsSync(path.join(bare, 'features', 'refunds', 'tests'))).toBe(false);
    await page.screenshot({ path: path.join(SHOTS, '306-no-lock--dark.png') });

    // Generate on the declared project makes the tests, locked
    await open(request, dir);
    await gotoCockpit(page, '/tests');
    await page.getByTestId('empty-generate').click();
    await expect(page.getByTestId('generate-done')).toContainText('Generated 9 tests');
    await expect(page.getByTestId('state-empty')).toHaveCount(0);
  });

  test('a feature with no readable flow says so and still offers a hand-written test', async ({ page, request }) => {
    const dir = makeProject({ source: NO_MACHINE });
    await open(request, dir);
    await gotoCockpit(page, '/tests');
    const none = page.getByTestId('state-no-flow');
    await expect(none).toContainText('This feature has no flow to test');
    await expect(none).toContainText('no initial state');
    await expect(none.getByTestId('noflow-new')).toBeDisabled();
    await page.screenshot({ path: path.join(SHOTS, '306-no-flow--dark.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);
  });

  test('never run, both failure kinds side by side, and browsers not installed', async ({ page, request }) => {
    const dir = makeProject();
    generate(dir);
    await open(request, dir);
    // The ONE stand-in in this spec: the machine running the spec has its browsers installed, so the environment part of
    // the listing is answered as a machine without them would answer (the server's own check is unit-tested).
    await page.route('**/api/tests/refunds', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, environment: { browsers: 'missing' } } });
    });
    await gotoCockpit(page, '/tests');
    const browsers = page.getByTestId('state-browsers');
    await expect(browsers).toContainText('Browsers are not installed');
    await expect(browsers.getByTestId('browsers-command')).toHaveText('npx playwright install chromium');
    await browsers.screenshot({ path: path.join(SHOTS, '306-browsers-missing--dark.png') });

    await page.getByRole('button', { name: 'Open the test for Happy path' }).click();
    await expect(page.getByTestId('detail-last-run')).toContainText('has not run yet');
    // #305: running from the Cockpit exists now, so a never-run test offers to run instead of saying it is not available
    await expect(page.getByTestId('detail-run')).toBeEnabled();
    await expect(page.getByTestId('detail-last-run')).not.toContainText('not available yet');

    await page.getByTestId('failure-kinds').locator('summary').click();
    const convention = page.getByTestId('kind-convention');
    const app = page.getByTestId('kind-app');
    await expect(convention).toContainText('Convention not met');
    await expect(convention).toContainText('Not a product bug');
    await expect(app).toContainText('App behaved differently');
    await expect(app).toContainText('bug report');
    const [a, b] = [await convention.boundingBox(), await app.boundingBox()];
    expect(Math.abs(a.y - b.y), 'side by side, on one row').toBeLessThan(4);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.getByTestId('failure-kinds').screenshot({ path: path.join(SHOTS, '306-failure-kinds--dark.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);
  });

  test('390 px: one pane at a time, the stale clone and its diff readable without horizontal scrolling', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dir = makeProject();
    generate(dir);
    await open(request, dir);
    const happy = fs.readdirSync(path.join(dir, 'features', 'refunds', 'tests', 'generated')).sort().find((f) => /happy-path/.test(f));
    expect((await (await request.post(`${API}/api/tests/refunds/clone`, { data: { source: happy, name: 'happy-copy' } })).json()).ok).toBe(true);
    fs.writeFileSync(flow(dir), AUDITED);
    generate(dir);

    const noHScroll = async () => {
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(scroll).toBeLessThanOrEqual(inner);
    };
    await gotoCockpit(page, '/tests');
    const bar = page.getByRole('tablist', { name: 'Panes' });
    await expect(bar.getByRole('tab', { name: 'Stage' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('stale-overview')).toBeVisible();
    await noHScroll();
    await page.screenshot({ path: path.join(SHOTS, '306-narrow-stage--dark.png') });

    await page.getByTestId('stale-open').click();
    await bar.getByRole('tab', { name: 'Tools' }).click();
    const banner = page.getByTestId('stale-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId('stale-change').first()).toBeVisible();
    await noHScroll();
    await page.screenshot({ path: path.join(SHOTS, '306-narrow-tools--dark.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);
  });
});
