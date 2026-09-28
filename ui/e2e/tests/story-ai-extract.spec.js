import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots/story');
fs.mkdirSync(SHOTS, { recursive: true });

// #387 (part of #367, design docs/design/ia-five-screens.md section 9.6) -- "AI proposes the parse pattern
// once; verified per-use extraction for public pages". Two kinds of coverage, matching the split
// `story-bridge.spec.js` (#386) already uses:
//   - browser-level, against the real Cockpit and real ui/server: the Story tab's UI wiring -- skeleton
//     preview shown before anything else, the diff review, and the "model offline" fallback state. The two
//     model-calling endpoints (`/api/story-ai/pattern/propose`, `/api/story-ai/extract`) are stubbed with
//     `page.route` for these UI assertions ONLY, because a real local model's exact JSON reply cannot be
//     scripted for a deterministic UI test (no existing repo precedent mocks a model any other way, see the
//     #382 comment style: "you'll need to stub whatever HTTP call your route makes"). The endpoints'
//     real logic (selector re-validation, match-checking, quoted-text verification, MODEL_OFFLINE) is
//     exercised for real, with an injected fake model, in `ui/server/src/storyAiApi.test.mjs`.
//   - request-fixture-level, against the real running server and a real throwaway git project, no mocking at
//     all: `/api/story-ai/skeleton` (no model call, fully deterministic) and the new
//     `/api/story-bridge/values-preview` + `/values-save` round trip this slice adds.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const SOURCE_URL = 'https://example.com/delivery-delay';
const PAGE_HTML = '<html><body><h1 class="title">Delivery delay banner</h1><p class="summary">Shows only on delivered orders.</p></body></html>';

const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const panel = (page) => page.getByTestId('story-pattern-panel');

async function openStoryTab(page, { feature, url }) {
  await gotoCockpit(page, '/');
  await browserTabs(page).getByRole('tab', { name: 'Story' }).click();
  await page.getByTestId('story-tab-feature').fill(feature);
  await page.getByTestId('story-tab-url').fill(url);
  await page.getByTestId('story-tab-open').click();
}

test.describe.serial('Story tab: AI proposes the pattern once, verified per-use extraction (#387)', () => {
  let repo;
  let restore;

  test.beforeAll(async () => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og387-story-ai-')));
    fs.mkdirSync(path.join(repo, 'features/delivery'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'architecture.yml'),
      'version: 1\npreset: strict-nextjs\n\nproject:\n  framework: nextjs\n  language: typescript\n\nfeatures:\n  root: features\n',
    );
    fs.writeFileSync(
      path.join(repo, 'features/delivery/story.md'),
      '---\nsources: []\n---\n# Delivery delay banner\n\nWritten by hand.\n',
    );
    const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    restore = await openProject(API, repo);
  });
  test.afterAll(async () => {
    await restore?.();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('fetching a page shows the structure preview before anything is proposed; pattern proposal lands as an approvable diff, then refreshes mechanically', async ({ page }) => {
    await page.route('**/api/story/fetch', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, via: 'server', status: 200, url: SOURCE_URL, redirects: 0, text: PAGE_HTML, selectors: {} }),
    }));
    await page.route('**/api/story-ai/pattern/propose', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, feature: 'delivery', url: SOURCE_URL, parse: { title: '.title' }, rejectedFields: [], calls: 1, sentBytes: 42, truncated: false }),
    }));

    await openStoryTab(page, { feature: 'delivery', url: SOURCE_URL });
    await panel(page).getByTestId('story-fetch-page').click();

    // Skeleton preview is shown before any model call is made.
    await expect(panel(page).getByTestId('story-skeleton-preview')).toBeVisible();
    await expect(panel(page).getByTestId('story-skeleton-text')).toContainText('h1');

    // No pattern is saved yet, so the control is in its "ai-only" state (no Mechanical/AI toggle -- there is
    // no mechanical block to fall back to until a pattern exists). Run "Propose parse pattern": the mocked
    // model call proposes one selector; the real server (storyBridgeApi.mjs, unmocked) computes and shows
    // the diff.
    const proposeControl = page.locator('[data-testid="generate-control"][data-action-id="story.pattern-propose"]');
    await expect(proposeControl).toHaveAttribute('data-view-state', 'ai-only');
    await proposeControl.getByTestId('generate-run').click();

    await expect(panel(page).getByTestId('story-diff-review')).toBeVisible();
    await expect(panel(page).getByTestId('story-diff-after')).toContainText(SOURCE_URL);
    await expect(panel(page).getByTestId('story-diff-after')).toContainText('.title');

    await page.screenshot({ path: path.join(SHOTS, 'story-diff-review--dark.png') });

    await panel(page).getByTestId('story-diff-approve').click();
    await expect(panel(page).getByTestId('story-diff-review')).toBeHidden();
    expect(fs.readFileSync(path.join(repo, 'features/delivery/story.md'), 'utf8')).toContain(SOURCE_URL);

    // Once a pattern is saved, the control's mechanical slot is filled -- refreshing costs 0 model calls.
    await expect(proposeControl.getByTestId('generate-mode-mechanical')).toBeVisible();
    await proposeControl.getByTestId('generate-mode-mechanical').click();
    await proposeControl.getByTestId('generate-run').click();
    await expect(panel(page).getByTestId('story-pattern-status')).toContainText('0 model calls');
  });

  test('extraction on every use: an unverifiable value is rejected, never written as a diff', async ({ page }) => {
    await page.route('**/api/story/fetch', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, via: 'server', status: 200, url: SOURCE_URL, redirects: 0, text: PAGE_HTML, selectors: {} }),
    }));
    await page.route('**/api/story-ai/extract', (route) => route.fulfill({
      status: 422, contentType: 'application/json',
      body: JSON.stringify({ ok: false, code: 'NOTHING_VERIFIED', error: 'No extracted value was found verbatim in the fetched page text.', rejected: [{ name: 'title', value: 'A total fabrication', reason: 'Not found verbatim in the fetched page text.' }] }),
    }));

    await openStoryTab(page, { feature: 'delivery', url: SOURCE_URL });
    await panel(page).getByTestId('story-fetch-page').click();

    const extractControl = page.locator('[data-testid="generate-control"][data-action-id="story.extract-values"]');
    await extractControl.getByTestId('generate-run').click();

    await expect(panel(page).getByTestId('story-extract-status')).toContainText('rejected');
    await expect(panel(page).getByTestId('story-diff-review')).toBeHidden();
  });

  test('AI unavailable: the panel states the snapshot fallback, not a hung or silent request', async ({ page }) => {
    await page.route('**/api/story/fetch', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, via: 'server', status: 200, url: SOURCE_URL, redirects: 0, text: PAGE_HTML, selectors: {} }),
    }));
    // The real ollama daemon on this box is a live, shared resource this spec must not stop; the "offline"
    // response itself is exactly what storyAiApi.mjs sends for real when getOllamaStatus() reports not running
    // (storyAiApi.test.mjs proves that wiring with an injected fake status check) -- this stubs only the
    // network hop so the UI's rendering of that response is exercised deterministically.
    await page.route('**/api/story-ai/pattern/propose', (route) => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ ok: false, code: 'MODEL_OFFLINE', error: 'The local model is offline. Using the last snapshot instead of sending anything.' }),
    }));

    await openStoryTab(page, { feature: 'delivery', url: SOURCE_URL });
    await panel(page).getByTestId('story-fetch-page').click();

    const proposeControl = page.locator('[data-testid="generate-control"][data-action-id="story.pattern-propose"]');
    await proposeControl.getByTestId('generate-run').click();
    await expect(panel(page).getByTestId('story-pattern-status')).toContainText('offline');
  });
});

test.describe.serial('Server: /api/story-ai/skeleton and the values-preview/values-save diff round trip (#387, unmocked)', () => {
  let repo;
  let restore;

  test.beforeAll(async () => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og387-story-ai-server-')));
    fs.mkdirSync(path.join(repo, 'features/delivery'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'architecture.yml'),
      'version: 1\npreset: strict-nextjs\n\nproject:\n  framework: nextjs\n  language: typescript\n\nfeatures:\n  root: features\n',
    );
    fs.writeFileSync(
      path.join(repo, 'features/delivery/story.md'),
      `---\nsources:\n  - url: ${SOURCE_URL}\n    parse:\n      title: .title\n---\n# Delivery delay banner\n\nWritten by hand.\n`,
    );
    const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    restore = await openProject(API, repo);
  });
  test.afterAll(async () => {
    await restore?.();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('POST /api/story-ai/skeleton builds a real skeleton, no model call', async ({ request }) => {
    const r = await request.post(`${API}/api/story-ai/skeleton`, { data: { html: PAGE_HTML } });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.text).toContain('h1');
    expect(body.text).not.toContain('class='); // no attribute values, only id/class/data-testid names (design 9.6)
  });

  test('values-preview computes a diff without writing; values-save writes it, keeps the existing parse, never touches the hand-written body', async ({ request }) => {
    const values = { title: 'Delivery delay banner' };

    const preview = await request.post(`${API}/api/story-bridge/values-preview`, { data: { feature: 'delivery', url: SOURCE_URL, values } });
    expect(preview.status()).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.ok).toBe(true);
    expect(previewBody.changed).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'features/delivery/story.md'), 'utf8')).not.toContain('values:');

    const save = await request.post(`${API}/api/story-bridge/values-save`, { data: { feature: 'delivery', url: SOURCE_URL, values } });
    expect(save.status()).toBe(200);
    expect((await save.json()).changed).toBe(true);

    const onDisk = fs.readFileSync(path.join(repo, 'features/delivery/story.md'), 'utf8');
    expect(onDisk).toContain('Written by hand.');
    expect(onDisk).toContain('title: .title'); // the existing parse is kept
    expect(onDisk).toContain('Delivery delay banner');
  });

  test('values-save rejects a url with no existing source entry (422), and a missing values map (400)', async ({ request }) => {
    const noSource = await request.post(`${API}/api/story-bridge/values-preview`, { data: { feature: 'delivery', url: 'https://example.com/not-added-yet', values: { title: 'x' } } });
    expect(noSource.status()).toBe(422);
    const noValues = await request.post(`${API}/api/story-bridge/values-preview`, { data: { feature: 'delivery', url: SOURCE_URL } });
    expect(noValues.status()).toBe(400);
  });
});
