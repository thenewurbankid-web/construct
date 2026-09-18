import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// #77 follow-up to #54: auto-map's candidate list used to be filtered only
// by "is this name already passed down", not by whether the child
// component could actually use it — so a page's state setter (`setCount`)
// or unrelated in-scope name (`count`) could get offered for a child that
// never destructures them. This fixture's `Badge` child only destructures
// `{ label, title }` — deliberately NOT `count`/`setCount` — so a real
// browser run proves those two now get filtered out of the candidate list
// instead of merely being asserted at the API/unit level.
const FIXTURE_PAGE = `import React, { useState } from 'react';
import { Badge } from '../components/Badge';

export default function ProfilePage({ title }: { title: string }) {
  const [count, setCount] = useState(0);

  return (
    <main>
      <Badge label={count} />
    </main>
  );
}
`;

const FIXTURE_COMPONENT = `export function Badge({ label, title }: { label: number; title?: string }) {
  return (
    <span className="badge">
      {title}: {label}
    </span>
  );
}
`;

test.describe.serial('Auto-map cross-file candidate filtering (#77 follow-up to #54)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-automap-crossfile-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Profile', feature: 'people', layer: 'page' } });

    const pagePath = path.join(tmpProjectDir, 'features/people/pages/ProfilePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/people/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/components/Badge.tsx'), FIXTURE_COMPONENT);
  });

  test.afterAll(async ({ request }) => {
    // Same restore-known-good-projectDir rationale as pages-editor-editing.spec.js.
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('automap-crossfile.png — candidates the child cannot declare (count, setCount) are filtered out', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('people');
    const openButton = page.getByRole('button', { name: 'ProfilePage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.locator('.tree-panel').getByText('<Badge>', { exact: true }).click();
    await expect(page.locator('.automap-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Find unmapped props' }).click();

    // Cross-file resolution succeeded (Badge.tsx was found via the import
    // and its destructured params read) — the panel says so.
    await expect(page.locator('.automap-resolution-status')).toContainText(
      'Filtered to props the child component actually declares.',
    );

    const candidates = page.locator('.automap-candidates li');
    await expect(candidates).toHaveCount(1);
    await expect(candidates).toContainText(['title']);
    // The whole point: count/setCount are valid in-scope names but Badge
    // never declares them, so cross-file filtering must exclude both.
    await expect(page.locator('.automap-candidates li', { hasText: 'setCount' })).toHaveCount(0);
    await expect(page.locator('.automap-candidates li', { hasText: /^count$/ })).toHaveCount(0);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-automap-crossfile.png'), fullPage: true });
  });
});
