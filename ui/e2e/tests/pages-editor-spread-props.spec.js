import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// #77 follow-up to #53: spread props (`{...rest}`) used to be filtered out
// of the props inspector entirely -- they never appeared as rows at all.
// This fixture gives one element both a spread prop and a plain
// identifier-valued prop (`onClick={handleClick}`), so the test proves (a)
// the spread now shows up as its own editable row and (b) the raw-code
// fallback used by both the spread and the identifier prop is now clearly
// labeled instead of looking like an untyped/broken text field.
const FIXTURE_PAGE = `import React from 'react';

export default function ButtonsPage() {
  const rest = { 'data-test': true };
  const handleClick = () => {};

  return (
    <main>
      <button className="primary" {...rest} onClick={handleClick}>
        Go
      </button>
    </main>
  );
}
`;

test.describe.serial('Props inspector: spread props editable, raw-code fallback labeled (#77 follow-up to #53)', () => {
  let tmpProjectDir;
  let pagePath;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-spread-props-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Buttons', feature: 'widgets', layer: 'page' } });

    pagePath = path.join(tmpProjectDir, 'features/widgets/pages/ButtonsPage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-spread-props.png — a spread prop lists as a row and its expression is editable', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('widgets');
    const openButton = page.getByRole('button', { name: 'ButtonsPage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.locator('.tree-panel').getByText('<button>', { exact: true }).click();
    await expect(page.locator('.props-inspector')).toBeVisible();

    // The spread prop is now a visible row, labeled like real JSX
    // (`{...rest}`), not silently dropped.
    const spreadRow = page.locator('.prop-row', { has: page.locator('.prop-name', { hasText: '{...rest}' }) });
    await expect(spreadRow).toBeVisible();
    await expect(spreadRow.locator('.prop-kind-hint')).toHaveText('spread');
    await expect(spreadRow.locator('input[type="text"]')).toHaveValue('rest');

    // The identifier-valued prop (onClick={handleClick}) also gets the
    // "expression" hint now, not just a plain, unlabeled text box.
    const onClickRow = page.locator('.prop-row', { has: page.locator('.prop-name', { hasText: 'onClick' }) });
    await expect(onClickRow.locator('.prop-kind-hint')).toHaveText('expression');

    // Edit the spread's underlying expression and save -- the required
    // bar per #77 is raw-text edit of the spread expression itself.
    await spreadRow.locator('input[type="text"]').fill('otherProps');
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/props') && res.request().method() === 'POST'),
      spreadRow.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).ok).toBe(true);

    const onDisk = fs.readFileSync(pagePath, 'utf8');
    expect(onDisk).toContain('{...otherProps}');
    expect(onDisk).toContain('onClick={handleClick}'); // untouched sibling attribute

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-spread-props.png'), fullPage: true });
  });
});
