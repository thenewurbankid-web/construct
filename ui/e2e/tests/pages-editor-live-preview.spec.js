import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateJsxSource } from '../../../src/engine/jsxSourceAnnotator.mjs';
import { previewBridgeScript } from '../../../src/engine/previewBridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT) || 5125;

const FIXTURE_PAGE = `export default function HomePage({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <p>Welcome back</p>
    </main>
  );
}
`;

// Stand-in for a target dev server: renders the page's elements as HTML, each
// carrying the data-cx-src value the REAL core annotator computed for the
// fixture source, plus the REAL preview bridge script.
function previewHtml(annotatedSource) {
  const src = (tag) => new RegExp(`<${tag} data-cx-src="([^"]+)"`).exec(annotatedSource)[1];
  return `<!doctype html><html><body style="font-family:sans-serif;padding:24px">
<main data-cx-src="${src('main')}"><h1 data-cx-src="${src('h1')}">Hello from the target app</h1>
<p data-cx-src="${src('p')}">Welcome back</p>
<footer data-cx-src="features/billing/components/Footer.tsx:2:3">Footer (another file)</footer></main>
<script>${previewBridgeScript()}</script></body></html>`;
}

// The preview's own messages are read by class, not by `getByRole('status')`:
// the Pages screen carries other live regions too (the commit-on-save
// indicator, the external-change notice), so the role alone is ambiguous.
test.describe('Pages Editor: live preview + click-to-source', () => {
  let tmpProjectDir;
  let previewServer;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-live-preview-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx'), FIXTURE_PAGE);
    const { code } = annotateJsxSource(FIXTURE_PAGE, { file: 'features/billing/pages/HomePage.tsx' });
    const html = previewHtml(code);
    previewServer = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
    await new Promise((r) => previewServer.listen(PREVIEW_PORT, '127.0.0.1', r));
  });

  test.afterAll(async ({ request }) => {
    previewServer?.close();
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-live-preview.png — clicking an element in the framed app selects its node in the tree and inspector', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('billing');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.getByLabel('Preview URL').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Load preview' }).click();
    await expect(page.locator('.live-preview-message')).toContainText('http(s) URL');

    await page.getByLabel('Preview URL').fill(`http://127.0.0.1:${PREVIEW_PORT}/`);
    await page.getByRole('button', { name: 'Load preview' }).click();
    const frame = page.frameLocator('iframe[title="Live app preview"]');
    await expect(frame.locator('h1')).toBeVisible();

    await frame.locator('p').click();
    // The <p> node is now selected in the tree...
    await expect(page.locator('.tree-panel .tree-node.selected')).toContainText('p');
    await expect(page.locator('.live-preview-message')).toContainText('HomePage.tsx:5:7');

    await frame.locator('h1').click();
    await expect(page.locator('.tree-panel .tree-node.selected')).toContainText('h1');

    // An element from another file does not steal the selection.
    await frame.locator('footer').click();
    await expect(page.locator('.live-preview-message')).toContainText('Footer.tsx');
    await expect(page.locator('.tree-panel .tree-node.selected')).toContainText('h1');

    await frame.locator('p').click();
    await page.locator('.live-preview-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-live-preview.png'), fullPage: true });
  });
});
