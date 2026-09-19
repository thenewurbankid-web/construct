import { test, expect } from '@playwright/test';

// Epic 6.1 (#97). The "not detected" / install-guidance state is exercised
// with the status endpoint mocked as not-running (#250): a machine that DOES
// have Ollama running would otherwise fail this spec for an environmental
// reason. The "running" / model-list / pull-progress states are exercised
// against a mocked Ollama HTTP response via Playwright route interception,
// since a real multi-GB model pull isn't feasible in this environment — see
// the #97 issue comment for this documented exception.

test('Ollama not detected: shows install guidance, never auto-runs anything', async ({ page }) => {
  await page.route('**/api/ollama/status', (route) =>
    route.fulfill({ json: { running: false, host: 'http://localhost:11434' } }));
  await page.goto('/ollama');
  await expect(page.getByRole('heading', { name: 'Local model (Ollama)' })).toBeVisible();
  await expect(page.getByText('Not detected')).toBeVisible();
  await expect(page.getByRole('heading', { name: "Ollama isn't running" })).toBeVisible();
  await expect(page.getByRole('link', { name: /ollama\.com\/download/ })).toBeVisible();
  // No installed-model list or pull form should render until Ollama is up.
  await expect(page.locator('.ollama-models')).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/ollama-not-detected.png', fullPage: true });
});

test('Ollama running: lists installed models and pulls a new one (mocked Ollama API)', async ({ page }) => {
  await page.route('**/api/ollama/status', (route) =>
    route.fulfill({ json: { running: true, version: '0.3.12', host: 'http://localhost:11434' } }));
  await page.route('**/api/ollama/models', (route) =>
    route.fulfill({ json: { models: [{ name: 'qwen2.5-coder:0.5b', size: 397_800_000, modified_at: '2026-09-01T00:00:00Z' }] } }));

  await page.goto('/ollama');
  await expect(page.getByText('Running')).toBeVisible();
  await expect(page.getByText('v0.3.12')).toBeVisible();
  await expect(page.locator('.ollama-models')).toContainText('qwen2.5-coder:0.5b');
  await expect(page.locator('.ollama-models')).toContainText('379.4 MB');
  await page.screenshot({ path: 'screenshots/ollama-models.png', fullPage: true });

  // Pull a model — mock the streamed NDJSON progress response.
  const ndjson = [
    JSON.stringify({ status: 'pulling manifest' }),
    JSON.stringify({ status: 'downloading', completed: 50, total: 100 }),
    JSON.stringify({ status: 'success' }),
  ].join('\n') + '\n';
  // A small artificial delay before fulfilling keeps the "pulling" state
  // visible long enough for the assertion below to observe it — a real
  // pull streams progressively over seconds/minutes; an instantly-resolved
  // mock would otherwise flip straight through "pulling" to "done" within
  // one React commit.
  await page.route('**/api/ollama/pull', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson });
  });

  await page.getByPlaceholder('qwen2.5-coder:0.5b').fill('qwen2.5-coder:1.5b');
  await page.getByRole('button', { name: /^Pull$/ }).click();
  // The button flips to "Pulling…" immediately (before the mocked response
  // even resolves, matching how a real pull's request kicks off before any
  // progress event arrives) — stable enough to assert and screenshot.
  await expect(page.getByRole('button', { name: 'Pulling…' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/ollama-pull.png', fullPage: true });
  // Once the mocked stream resolves, the button returns to "Pull" and no
  // error is shown — confirming the whole pull -> progress -> done flow
  // completed without an unhandled rejection or a swallowed error.
  await expect(page.getByRole('button', { name: /^Pull$/ })).toBeVisible();
  await expect(page.locator('.status-error')).toHaveCount(0);
});
