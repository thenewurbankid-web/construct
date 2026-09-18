import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// Ticket F.2 (#121, epic #119) — dragging a wire's child-side endpoint onto
// a different sibling rewrites the real source: `title` moves off `<Card>`
// and onto `<Aside>`, expressed as two attribute splices (remove + add),
// not a second, hand-maintained data model.
const FIXTURE_PAGE = `import React from 'react';
import { Card } from '../components/Card';
import { Aside } from '../components/Aside';

export default function HomePage({ title }: { title: string }) {
  return (
    <main>
      <Card title={title} />
      <Aside />
    </main>
  );
}
`;
const FIXTURE_CARD = `export function Card({ title }: { title: string }) {
  return <section>{title}</section>;
}
`;
const FIXTURE_ASIDE = `export function Aside() {
  return <aside>hi</aside>;
}
`;

test.describe('Pages Editor: visual composer wire rewrite (#121, epic #119)', () => {
  let tmpProjectDir;
  let pagePath;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-flow-rewire-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'catalog', layer: 'page' } });
    pagePath = path.join(tmpProjectDir, 'features/catalog/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/catalog/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/components/Card.tsx'), FIXTURE_CARD);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/components/Aside.tsx'), FIXTURE_ASIDE);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-flow-rewire.png — dragging a wire to a new sibling patches the real source, through the existing diff-preview flow', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('catalog');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();

    await expect(page.locator('.jsx-flow-node')).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await page.locator('.snippet-flow-canvas').scrollIntoViewIfNeeded();

    // Drag the edge's child-side reconnect anchor from <Card> onto <Aside>'s
    // whole-node drop zone.
    const edgeUpdater = page.locator('[data-id="e:n0:n1:title"] .react-flow__edgeupdater-target');
    const target = page.locator('[data-nodeid="n2"].jsx-flow-handle-wildcard');
    const edgeBox = await edgeUpdater.boundingBox();
    const targetBox = await target.boundingBox();

    const [rewireResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/snippet-rewire')),
      (async () => {
        await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-flow-rewire.png') });
        await page.mouse.up();
      })(),
    ]);
    const rewireBody = await rewireResponse.json();
    expect(rewireBody.ok).toBe(true);
    expect(rewireBody.snippet).toContain('<Aside title={title}');
    expect(rewireBody.snippet).not.toContain('Card title');

    // The rewire must land in the *existing* diff-preview flow (#81) — not
    // write to disk immediately.
    const diffPreview = page.locator('.snippet-diff-preview');
    await expect(diffPreview).toBeVisible();
    await expect(diffPreview.locator('.diff-removed')).toContainText('title={title}');
    await expect(diffPreview.locator('.diff-added')).toContainText('Aside title={title}');
    expect(fs.readFileSync(pagePath, 'utf8')).not.toContain('<Aside title={title}');

    const [saveResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/node') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Confirm save' }).click(),
    ]);
    expect(saveResponse.ok()).toBeTruthy();
    const saved = fs.readFileSync(pagePath, 'utf8');
    expect(saved).toContain('<Aside title={title}');
    expect(saved).not.toMatch(/<Card[^/]*title=/);
  });

  test('an invalid rewire (target already has the prop) shows an inline error and writes nothing', async ({ page }) => {
    const conflictPage = `import React from 'react';
import { Card } from '../components/Card';
import { Aside } from '../components/Aside2';

export default function HomePage({ title, other }: { title: string; other: string }) {
  return (
    <main>
      <Card title={title} />
      <Aside title={other} />
    </main>
  );
}
`;
    fs.writeFileSync(pagePath, conflictPage);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/components/Aside2.tsx'), `export function Aside({ title }: { title: string }) {\n  return <aside>{title}</aside>;\n}\n`);

    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('catalog');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();
    await expect(page.locator('.jsx-flow-node')).toHaveCount(3, { timeout: 10_000 });
    await page.locator('.snippet-flow-canvas').scrollIntoViewIfNeeded();

    const edgeUpdater = page.locator('[data-id="e:n0:n1:title"] .react-flow__edgeupdater-target');
    const target = page.locator('[data-nodeid="n2"].jsx-flow-handle-wildcard');
    const edgeBox = await edgeUpdater.boundingBox();
    const targetBox = await target.boundingBox();

    const [rewireResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/snippet-rewire')),
      (async () => {
        await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        await page.mouse.up();
      })(),
    ]);
    expect((await rewireResponse.json()).ok).toBe(false);

    await expect(page.locator('.snippet-flow-wire-error')).toContainText('already has its own "title" prop');
    await expect(page.locator('.snippet-diff-preview')).toBeHidden();
    expect(fs.readFileSync(pagePath, 'utf8')).toEqual(conflictPage);
  });
});
