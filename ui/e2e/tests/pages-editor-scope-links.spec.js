import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #223 — scope/binding link panel. `Card` gets `title` and `total` from page scope, a literal `label`
// it does not declare, and leaves `onClose`/`open` unbound (`open` is in page scope). `Foo.Bar` is a
// compound child resolved from its imported file. `setOpen`/`draft`-style names never passed are
// flagged unused.
const FIXTURE_PAGE = `import React, { useState } from 'react';
import { Card } from '../components/Card';
import { Foo } from '../components/Foo';

export default function ProfilePage({ title, count }: { title: string; count: number }) {
  const [open, setOpen] = useState(false);

  return (
    <main>
      <Card title={title} total={count + 1} label="hi" />
      <Foo.Bar size={count} />
    </main>
  );
}
`;

const CARD = `export function Card({ title, total, onClose, open }: { title: string; total: number; onClose?: () => void; open?: boolean }) {
  return <div>{title}{total}</div>;
}
`;

const FOO = `export function Foo() { return null; }
export function Bar({ size, tone }: { size: number; tone?: string }) {
  return <span>{size}{tone}</span>;
}
`;

test.describe.serial('Pages Editor scope links (#223)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-scope-links-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Profile', feature: 'people', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/pages/ProfilePage.tsx'), FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/people/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/components/Card.tsx'), CARD);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/components/Foo.tsx'), FOO);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('scope-links.png — links, unbound/undeclared flags, compound child', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('people');
    await page.getByRole('button', { name: 'ProfilePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.locator('.tree-panel').getByText('<Card>', { exact: true }).click();
    // Scope links are their own tab of the shell's Tools panel (#247), no longer inline under the inspector.
    await page.getByRole('tab', { name: 'Scope' }).click();
    const panel = page.locator('.scope-panel');
    await expect(panel).toBeVisible();

    // Colour-coded links from page scope into Card's props.
    await expect(panel.locator('path.scope-edge[data-from="title"][data-to="title"]')).toHaveCount(1);
    await expect(panel.locator('path.scope-edge[data-from="count"][data-to="total"]')).toHaveCount(1);
    await expect(panel.locator('.scope-target.scope-status-unbound')).toHaveCount(2);
    await expect(panel.locator('.scope-target.scope-status-undeclared')).toContainText('label');
    await expect(panel.locator('.scope-flag-warn', { hasText: 'Unbound prop "open"' })).toContainText('auto-map');
    await expect(panel.locator('.scope-flag-info', { hasText: '"setOpen" is declared but never passed' })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-scope-links.png') });

    // Compound child Foo.Bar: `size` linked from `count`, `tone` unbound.
    await page.locator('.tree-panel').getByText('<Foo.Bar>', { exact: true }).click();
    await expect(panel.locator('path.scope-edge[data-from="count"][data-to="size"]')).toHaveCount(1);
    await expect(panel.locator('.scope-flag-warn', { hasText: 'Unbound prop "tone"' })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-scope-links-compound.png') });
  });
});
