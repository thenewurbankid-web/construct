import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #77 follow-up to #75: pill width used to be a fixed name.length*charWidth
// heuristic, and pills only ever showed a prop's name, never its value.
// This fixture gives one child a very short prop name (`n`) and another a
// long one (`extraordinarilyLongPropName`) so real canvas text measurement
// (vs. the old fixed-heuristic width) is actually exercised across a wide
// size range, plus a string-valued prop so the "Show prop values" toggle
// has something concrete to reveal.
const FIXTURE_PAGE = `import React from 'react';
import { Wide } from '../components/Wide';

export default function HomePage() {
  return (
    <main>
      <Wide n={1} extraordinarilyLongPropName="hello" status="active" />
    </main>
  );
}
`;

const FIXTURE_COMPONENT = `export function Wide({ n, extraordinarilyLongPropName, status }: { n: number; extraordinarilyLongPropName: string; status: string }) {
  return (
    <div>
      {n} {extraordinarilyLongPropName} {status}
    </div>
  );
}
`;

test.describe.serial('Prop-flow diagram real text-metrics sizing + value display (#77 follow-up to #75)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-propflow-values-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'catalog', layer: 'page' } });

    const pagePath = path.join(tmpProjectDir, 'features/catalog/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/catalog/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/components/Wide.tsx'), FIXTURE_COMPONENT);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-propflow-values.png — pill widths reflect real text width, and values can be toggled on', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('catalog');
    const openButton = page.getByRole('button', { name: 'HomePage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.getByRole('button', { name: 'Show diagram' }).click();
    await expect(page.locator('.propflow-svg')).toBeVisible();

    const shortPill = page.locator('.propflow-pill-outgoing', { hasText: /^n$/ });
    const longPill = page.locator('.propflow-pill-outgoing', { hasText: 'extraordinarilyLongPropName' });
    await expect(shortPill).toBeVisible();
    await expect(longPill).toBeVisible();
    const [shortWidth, longWidth] = await Promise.all([
      shortPill.evaluate((el) => el.getBoundingClientRect().width),
      longPill.evaluate((el) => el.getBoundingClientRect().width),
    ]);
    // Real text measurement: the long name's pill must be substantially
    // wider than the one-character name's, proportional to actual glyph
    // width, not a coincidence of the old fixed per-char heuristic.
    expect(longWidth).toBeGreaterThan(shortWidth * 3);

    // Values are hidden by default.
    await expect(page.locator('.propflow-pill-received')).toContainText(['n', 'extraordinarilyLongPropName', 'status']);
    await expect(page.locator('.propflow-pill-received', { hasText: 'active' })).toHaveCount(0);

    const toggle = page.locator('.propflow-show-values input[type="checkbox"]');
    await expect(toggle).not.toBeChecked();
    await toggle.check();

    // Toggled on: the `status` received pill now shows its value too.
    await expect(page.locator('.propflow-pill-received', { hasText: 'status: active' })).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-propflow-values.png'), fullPage: true });
  });
});
