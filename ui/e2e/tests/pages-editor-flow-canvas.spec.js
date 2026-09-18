import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// Ticket F.1 (#120, epic #119) — the visual composer's read-only React Flow
// canvas, rendered below the existing code editor for the selected node's
// snippet. `Card` is a custom component (rendered with a distinct node
// style) receiving `title` from its own parent, so the fixture exercises
// both a plain element and a wired custom-component node/edge.
const FIXTURE_PAGE = `import React from 'react';
import { Card } from '../components/Card';

export default function HomePage({ title }: { title: string }) {
  return (
    <main>
      <Card title={title}>
        <p>Body</p>
      </Card>
    </main>
  );
}
`;

const FIXTURE_COMPONENT = `export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
`;

test.describe('Pages Editor: visual composer read-only canvas (#120, epic #119)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-flow-canvas-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'catalog', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/pages/HomePage.tsx'), FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/catalog/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/components/Card.tsx'), FIXTURE_COMPONENT);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-flow-canvas.png — renders real React Flow nodes/edges derived from the snippet source', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('catalog');
    const openButton = page.getByRole('button', { name: 'HomePage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    // Select the outer <main> node — its own snippet (`<main><Card
    // title={title}><p>Body</p></Card></main>`) contains a real parent ->
    // child prop wire (main hands `title` down to Card), so the canvas
    // below has to render an actual edge, not just isolated node boxes.
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();
    // F.4 (#123) made Code/Visual a real toggle — Code is the default view.
    await page.getByRole('button', { name: 'Visual', exact: true }).click();

    const canvas = page.locator('.snippet-flow-canvas');
    await expect(canvas).toBeVisible();
    // React Flow renders real DOM nodes for each graph node/edge — assert
    // on those directly rather than trusting a static screenshot.
    await expect(page.locator('.react-flow')).toBeVisible();
    await expect(page.locator('.jsx-flow-node')).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator('.jsx-flow-node.component')).toContainText('Card');
    await expect(page.locator('.jsx-flow-node').filter({ hasText: '<p>' })).toBeVisible();
    // The `title` prop flows main -> Card: a real React Flow edge, derived
    // from the snippet's own parse (PropFlowGeometry's layout, reused
    // rather than re-derived), not a second, hand-maintained structure.
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(page.locator('.jsx-flow-handle-outgoing')).toBeVisible();
    await expect(page.locator('.jsx-flow-handle-received')).toBeVisible();

    // .inspector-panel scrolls internally (max-height: 70vh) — scroll the
    // canvas fully into view first so a full-page screenshot doesn't just
    // catch whatever fit above that nested scroll's fold.
    await canvas.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-flow-canvas.png'), fullPage: true });
  });
});
