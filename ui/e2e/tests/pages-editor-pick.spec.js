import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateJsxSource } from '../../../packages/engine/jsxSourceAnnotator.mjs';
import { previewBridgeScript } from '../../../packages/engine/previewBridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT) || 5126;

// #375 — Pick toggle + Alt+Click: off by default so the framed app is a normal, clickable app;
// an un-modified click only selects an element while Pick is on, Alt+Click always works either
// way, and Escape leaves Pick. The <button> below has a real onclick handler (no `data-cx-src`
// annotation would suppress it anyway) so a passed-through click is independently observable,
// not just inferred from "the Cockpit didn't select anything".
const FIXTURE_PAGE = `export default function HomePage() {
  return (
    <main>
      <p>Welcome back</p>
    </main>
  );
}
`;

function previewHtml(annotatedSource) {
  const src = (tag) => new RegExp(`<${tag} data-cx-src="([^"]+)"`).exec(annotatedSource)[1];
  return `<!doctype html><html><body style="font-family:sans-serif;padding:24px">
<main data-cx-src="${src('main')}">
<p data-cx-src="${src('p')}" onclick="window.__realClicks = (window.__realClicks || 0) + 1">Welcome back</p>
</main>
<script>${previewBridgeScript()}</script></body></html>`;
}

test.describe.serial('Pages Editor: Pick toggle + Alt+Click-to-source (#375)', () => {
  let tmpProjectDir;
  let previewServer;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-pick-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx'), FIXTURE_PAGE);
    const { code } = annotateJsxSource(FIXTURE_PAGE, { file: 'features/billing/pages/HomePage.tsx' });
    previewServer = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(previewHtml(code)); });
    await new Promise((r) => previewServer.listen(PREVIEW_PORT, '127.0.0.1', r));
  });

  test.afterAll(async ({ request }) => {
    previewServer?.close();
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  async function openPreview(page) {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('billing');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.getByLabel('Preview URL').fill(`http://127.0.0.1:${PREVIEW_PORT}/`);
    await page.getByRole('button', { name: 'Load preview' }).click();
    const frame = page.frameLocator('iframe[title="Live app preview"]');
    await expect(frame.locator('p')).toBeVisible();
    return frame;
  }

  test('pages-editor-pick.png — Pick off: a plain click reaches the app, not the Cockpit', async ({ page }) => {
    const frame = await openPreview(page);
    const pick = page.locator('.live-preview-pick');
    await expect(pick).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.live-preview-head h4')).toContainText('Alt+Click an element');

    await frame.locator('p').click();
    await expect(page.locator('.tree-panel .tree-node.selected')).toHaveCount(0);
    const frameEl = await page.locator('iframe[title="Live app preview"]').elementHandle();
    const clicks = await frameEl.contentFrame().then((f) => f.evaluate(() => window.__realClicks));
    expect(clicks).toBe(1);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-pick.png'), fullPage: true });
  });

  test('Alt+Click always selects, Pick on or off', async ({ page }) => {
    const frame = await openPreview(page);
    await frame.locator('p').click({ modifiers: ['Alt'] });
    await expect(page.locator('.tree-panel .tree-node.selected')).toContainText('p');
  });

  test('Pick on: a plain click selects; the button shows pressed; Escape leaves Pick', async ({ page }) => {
    const frame = await openPreview(page);
    const pick = page.locator('.live-preview-pick');

    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.live-preview-head h4')).toContainText('Pick is on');

    await frame.locator('p').click();
    await expect(page.locator('.tree-panel .tree-node.selected')).toContainText('p');

    // Escape is a top-window shortcut; move focus out of the iframe first (a keydown inside it
    // never bubbles across the frame boundary), the same way a real user would after clicking.
    await page.getByLabel('Preview URL').click();
    await page.keyboard.press('Escape');
    await expect(pick).toHaveAttribute('aria-pressed', 'false');
  });
});
