import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateJsxSource } from '../../../src/engine/jsxSourceAnnotator.mjs';
import { previewBridgeScript } from '../../../src/engine/previewBridge.mjs';
import { runAxe, isBlocking, format } from './support/axe.js';

// #456 — the Pages screen shows the real app full screen (and at device sizes),
// not a fixed 360px box. Full screen means the Cockpit stands down: rail,
// Browser/Tools panes, top bar, drawer and status bar all go; the app fills the
// viewport; Esc brings everything back with the selection — and the app's own
// state — untouched, because the iframe is never remounted or reloaded.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT) || 5930;

const FIXTURE_PAGE = `export default function LandingPage({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <p>Welcome back</p>
    </main>
  );
}
`;

// Stand-in for the target dev server, with the REAL preview bridge and the REAL
// annotator's source positions. The text box is how the test proves the app kept
// its own state across the trip into full screen and back.
function previewHtml(annotatedSource) {
  const src = (tag) => new RegExp(`<${tag} data-cx-src="([^"]+)"`).exec(annotatedSource)[1];
  return `<!doctype html><html><body style="font-family:sans-serif;padding:24px">
<main data-cx-src="${src('main')}"><h1 data-cx-src="${src('h1')}">Hello from the target app</h1>
<p data-cx-src="${src('p')}">Welcome back</p></main>
<input id="app-state" aria-label="App state" />
<script>${previewBridgeScript()}</script></body></html>`;
}

test.describe.serial('Pages Editor: full-screen preview and device sizes (#456)', () => {
  let tmpProjectDir;
  let previewServer;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-fullscreen-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Landing', feature: 'shop', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/shop/pages/LandingPage.tsx'), FIXTURE_PAGE);
    const { code } = annotateJsxSource(FIXTURE_PAGE, { file: 'features/shop/pages/LandingPage.tsx' });
    const html = previewHtml(code);
    previewServer = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
    await new Promise((r) => previewServer.listen(PREVIEW_PORT, '127.0.0.1', r));
  });

  test.afterAll(async ({ request }) => {
    previewServer?.close();
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  async function openPreview(page) {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('shop');
    await page.getByRole('button', { name: 'LandingPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.getByLabel('Preview URL').fill(`http://127.0.0.1:${PREVIEW_PORT}/`);
    await page.getByRole('button', { name: 'Load preview' }).click();
    const frame = page.frameLocator('iframe[title="Live app preview"]');
    await expect(frame.locator('h1')).toBeVisible();
    return frame;
  }

  test('the frame fills the stage, at a real device size, with its size shown', async ({ page }) => {
    await openPreview(page);
    const box = page.locator('.live-preview-box');
    const measure = page.locator('.live-preview-measure');

    // Default (Fit): the stage's height, not the old hard-coded 360px.
    const fit = await box.boundingBox();
    expect(fit.height).toBeGreaterThan(360);
    await expect(measure).toHaveText(/^\d+ × \d+ px$/);

    // A device width is a real pixel width, and the readout says what it really is.
    await page.getByLabel('Size', { exact: true }).selectOption('w390');
    await expect.poll(async () => Math.round((await box.boundingBox()).width)).toBe(390);
    await expect(measure).toHaveText(/^390 × \d+ px$/);

    // A width the stage cannot give is not faked: the frame takes what there is
    // and the readout reports that, not the number that was asked for.
    await page.getByLabel('Size', { exact: true }).selectOption('w768');
    await expect.poll(async () => Math.round((await box.boundingBox()).width)).toBeLessThan(768);
    const real = Math.round((await box.boundingBox()).width);
    await expect(measure).toHaveText(new RegExp(`^${real} × \\d+ px$`));

    // Remembered per project: it is still 768 after a reload.
    await page.reload();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await expect(page.getByLabel('Size', { exact: true })).toHaveValue('w768');
    await page.getByLabel('Size', { exact: true }).selectOption('fit');
  });

  test('full screen hides the Cockpit, Esc restores it, and nothing is lost either way', async ({ page }) => {
    const frame = await openPreview(page);
    const viewport = page.viewportSize();

    // Something to lose: a selection in the Cockpit, and state inside the app itself.
    await frame.locator('p').click();
    await expect(page.locator('.tree-panel .tree-node.selected')).toContainText('p');
    await frame.locator('#app-state').fill('typed before full screen');

    await page.getByRole('button', { name: 'Full screen', exact: true }).click();

    // The app, nothing else: the frame is the viewport and the chrome is gone.
    const full = await page.locator('.live-preview-frame').boundingBox();
    expect(Math.round(full.width)).toBe(viewport.width);
    expect(Math.round(full.height)).toBe(viewport.height);
    await expect(page.locator('.sh-top')).toHaveCount(0);
    await expect(page.locator('.sh-rail')).toHaveCount(0);
    await expect(page.locator('.sh-status')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Browser' })).not.toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Tools' })).not.toBeVisible();
    await expect(page.locator('.pages-editor-page h1')).not.toBeVisible();

    // The way back is a real, labelled, focusable button — and the scans stay green.
    const exit = page.getByRole('button', { name: 'Leave full screen (Esc)' });
    await expect(exit).toBeEnabled();
    const found = await runAxe(page);
    expect(found.filter(isBlocking), `full screen\n${format(found.filter(isBlocking))}`).toEqual([]);

    await page.keyboard.press('Escape');

    // Everything is back, the selection survived, the app was never reloaded,
    // and focus is on the control that was pressed.
    await expect(page.locator('.sh-top')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Browser' })).toBeVisible();
    await expect(page.locator('.tree-panel .tree-node.selected')).toContainText('p');
    await expect(frame.locator('#app-state')).toHaveValue('typed before full screen');
    await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toBeFocused();

    // The exit button works too, and full screen honours the chosen device size.
    await page.getByLabel('Size', { exact: true }).selectOption('w390');
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    const phone = await page.locator('.live-preview-box').boundingBox();
    expect(Math.round(phone.width)).toBe(390);
    expect(Math.round(phone.height)).toBe(viewport.height);
    await page.getByRole('button', { name: 'Leave full screen (Esc)' }).click();
    await expect(page.locator('.sh-top')).toBeVisible();
    await page.getByLabel('Size', { exact: true }).selectOption('fit');
  });

  test('no dev server: a plain explanation, in the panel and full screen — never a blank rectangle', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('shop');
    await page.getByRole('button', { name: 'LandingPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    // Nothing configured yet.
    await expect(page.locator('.live-preview-empty')).toContainText('Point this at your app');
    await expect(page.locator('iframe[title="Live app preview"]')).toHaveCount(0);

    // Configured, but nothing is listening there.
    await page.getByLabel('Preview URL').fill('http://127.0.0.1:5931/');
    await page.getByRole('button', { name: 'Load preview' }).click();
    await expect(page.locator('.live-preview-empty')).toContainText('Nothing is answering');
    await expect(page.locator('.live-preview-empty')).toContainText('npm run dev');
    await expect(page.locator('iframe[title="Live app preview"]')).toHaveCount(0);

    // Full screen says the same thing rather than showing a blank white rectangle.
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(page.locator('.live-preview-empty')).toContainText('Nothing is answering');
    await expect(page.locator('.sh-top')).toHaveCount(0);
    await page.getByRole('button', { name: 'Leave full screen' }).click();
    await expect(page.locator('.sh-top')).toBeVisible();
  });
});
