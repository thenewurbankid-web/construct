import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #77 follow-up to #55/#75: the prop-flow diagram used to match purely by
// literal attribute name, one JSX level at a time, so a prop renamed while
// passing through an intermediate component showed up as two unrelated
// pills/colors instead of one traced flow. This fixture's `Middle` is
// itself given `label` under the attribute name `title`
// (`<Middle title={label}>`), and — nested inside Middle, in the same page
// file — hands the *same* `label` identifier to `Grandchild` under yet
// another name, `value` (`<Grandchild value={label}/>`). Neither attribute
// is literally named `label`, and `title` != `value`, so before this fix
// nothing would connect them; after it, `title` and `value` must share one
// legend color and a dashed same-node connector line traces the rename.
const FIXTURE_PAGE = `import React from 'react';
import { Middle } from '../components/Middle';
import { Grandchild } from '../components/Grandchild';

export default function HomePage({ label }: { label: string }) {
  return (
    <main>
      <Middle title={label}>
        <Grandchild value={label} />
      </Middle>
    </main>
  );
}
`;

const FIXTURE_MIDDLE = `export function Middle({ title, children }: { title: string; children?: unknown }) {
  return (
    <section>
      {title}
      {children}
    </section>
  );
}
`;

const FIXTURE_GRANDCHILD = `export function Grandchild({ value }: { value: string }) {
  return <span>{value}</span>;
}
`;

test.describe.serial('Prop-flow diagram cross-level rename tracing (#77 follow-up to #55/#75)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-propflow-rename-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'marketing', layer: 'page' } });

    const pagePath = path.join(tmpProjectDir, 'features/marketing/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/marketing/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/marketing/components/Middle.tsx'), FIXTURE_MIDDLE);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/marketing/components/Grandchild.tsx'), FIXTURE_GRANDCHILD);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-propflow-rename.png — a renamed prop (title -> value) traces across the intermediate component', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('marketing');
    const openButton = page.getByRole('button', { name: 'HomePage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.getByRole('button', { name: 'Show diagram' }).click();
    const svg = page.locator('.propflow-svg');
    await expect(svg).toBeVisible();

    // Two distinct attribute names flow through this fixture: `title`
    // (main -> Middle) and `value` (Middle -> Grandchild).
    await expect(page.locator('.propflow-legend-item')).toHaveCount(2);
    const titleSwatch = page.locator('.propflow-legend-item', { hasText: 'title' }).locator('.propflow-swatch');
    const valueSwatch = page.locator('.propflow-legend-item', { hasText: 'value' }).locator('.propflow-swatch');
    await expect(titleSwatch).toBeVisible();
    await expect(valueSwatch).toBeVisible();
    const [titleColor, valueColor] = await Promise.all([
      titleSwatch.evaluate((el) => getComputedStyle(el).backgroundColor),
      valueSwatch.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    // The whole point of #77: a renamed prop traced across Middle shares
    // ONE color end-to-end instead of two unrelated ones.
    expect(titleColor).toEqual(valueColor);

    // Four pills total: main's outgoing `title`, Middle's received `title`
    // + outgoing `value`, Grandchild's received `value`.
    await expect(page.locator('.propflow-pill')).toHaveCount(4);

    // A dashed same-node connector line traces title -> value inside
    // Middle, distinct from the two ordinary cross-level edges.
    const tracedLines = svg.locator('.propflow-line-traced');
    await expect(tracedLines).toHaveCount(1);
    const allLines = await svg.locator('line').count();
    expect(allLines).toBeGreaterThanOrEqual(3); // main->Middle, the traced connector, Middle->Grandchild

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-propflow-rename.png'), fullPage: true });
  });
});
