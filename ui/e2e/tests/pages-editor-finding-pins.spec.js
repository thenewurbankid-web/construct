import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { annotateJsxSource } from '../../../packages/engine/jsxSourceAnnotator.mjs';
import { previewBridgeScript } from '../../../packages/engine/previewBridge.mjs';

// #835 (design 8.2's numbered Findings pins on the live preview), end to end against a REAL rule
// violation (SLICE-002, a cross-feature import reaching another feature's internals -- the same shape
// #315's own fixture uses, here landing ON the open page file itself so it carries a real `line`), a
// REAL previewBridge rect round trip (`construct:rects-request`/`construct:rects`), and the REAL
// Inspector Findings section (#831).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const FIXTURE = path.resolve(__dirname, '../../../fixtures/impact-shared');
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT) || 5126;
const CHANGE = '/review?base=main&head=feat%2Fpin-finding';

// Deliberately a single JSX element (`<main>`), so the one SLICE-002 finding's pin always resolves to
// the one annotated node on screen -- no ambiguity about which pin should appear where.
const PAGE_SOURCE = `import { fetchCheckout } from '../../checkout/services/checkoutService';

export function BillingPage({ title }: { title: string }) {
  void fetchCheckout;
  return <main>{title}</main>;
}
`;

function previewHtml(annotatedSource) {
  const src = /<main data-cx-src="([^"]+)"/.exec(annotatedSource)[1];
  return `<!doctype html><html><body style="font-family:sans-serif;padding:24px">
<main data-cx-src="${src}">Hello from the target app</main>
<script>${previewBridgeScript()}</script></body></html>`;
}

test.describe.serial('Numbered Findings pins on the live preview (#835)', () => {
  let repo;
  let originalDir;
  let previewServer;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og835-pins-')));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feat/pin-finding');
    fs.writeFileSync(path.join(repo, 'features/billing/pages/BillingPage.tsx'), PAGE_SOURCE);
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'a page that reaches into checkout internals');
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: repo } });

    const { code } = annotateJsxSource(PAGE_SOURCE, { file: 'features/billing/pages/BillingPage.tsx' });
    const html = previewHtml(code);
    previewServer = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
    await new Promise((r) => previewServer.listen(PREVIEW_PORT, '127.0.0.1', r));
  });

  test.afterAll(async ({ request }) => {
    previewServer?.close();
    if (originalDir) await request.post(`${API_BASE}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('a real SLICE-002 finding on the open page shows a numbered pin at the right node; clicking it opens the matching Inspector finding', async ({ page }) => {
    // Triggers the real analysis (#315's own flow) so the finding exists before Pages opens it.
    await gotoCockpit(page, CHANGE);
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 90_000 });

    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('billing');
    const openButton = page.getByRole('button', { name: 'BillingPage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    // The Inspector (and so its Findings section) shows nothing until a node is selected.
    await page.locator('.tree-node').first().click();

    await page.getByLabel('Preview URL').fill(`http://127.0.0.1:${PREVIEW_PORT}/`);
    await page.getByRole('button', { name: 'Load preview' }).click();
    const frame = page.frameLocator('iframe[title="Live app preview"]');
    await expect(frame.locator('main')).toBeVisible();

    const pins = page.getByTestId('live-preview-pin');
    await expect(pins.first()).toBeVisible({ timeout: 10_000 });
    // At least the one SLICE-002 finding this test introduced -- not asserting an exact count, since
    // a real architecture check may also flag the same import under more than one rule.
    expect(await pins.count()).toBeGreaterThanOrEqual(1);
    await expect(pins.first()).toHaveText('1');
    await page.screenshot({ path: path.join(SHOTS, '835-finding-pin.png') });

    // Both findings land on the one JSX element this fixture has, so their pins stack exactly on top of
    // each other (a real, if unlovely, consequence of one node having two findings) -- force the click
    // the same way a person using a pointer directly over the top pin would still reach it.
    await pins.first().click({ force: true });
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const panel = tools.getByTestId('findings-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('findings-list')).toBeVisible();
    // Clicking the pin opened the Inspector's Findings section on exactly the matching finding.
    await expect(tools.locator('.findings-item--open')).toHaveCount(1);
    await expect(tools.locator('.findings-item--open')).toBeVisible();
  });
});
