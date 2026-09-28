import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #375 — Ctrl P quick-open: "Go to file, node or route" reuses the Ctrl K command palette
// (docs/design/ia-five-screens.md §8), registering one "Go to page" command per page so
// typing a feature or file name jumps straight to it, across features.
const LOGIN_PAGE = `export default function LoginPage({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
`;
const INVOICE_PAGE = `export default function InvoicePage() {
  return (
    <main>
      <h1>Invoice</h1>
    </main>
  );
}
`;

test.describe.serial('Pages Editor: Ctrl P quick-open (#375)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-pe-quick-open-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Login', feature: 'auth', layer: 'page' } });
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Invoice', feature: 'billing', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/auth/pages/LoginPage.tsx'), LOGIN_PAGE);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/pages/InvoicePage.tsx'), INVOICE_PAGE);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-quick-open.png — Ctrl P opens the palette; picking another feature\'s page jumps to it', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('auth');
    await page.getByRole('button', { name: 'LoginPage.tsx' }).click();
    await expect(page.getByTestId('pe-breadcrumb')).toContainText('LoginPage.tsx');

    // Ctrl P opens the same command palette Ctrl K does, pre-empting the browser's print dialog.
    await page.keyboard.press('Control+p');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('combobox', { name: 'Search commands' });
    await expect(input).toBeFocused();

    await input.fill('invoice');
    const option = dialog.getByRole('option', { name: /Go to billing\/InvoicePage\.tsx/ });
    await expect(option).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'pages-editor-quick-open.png') });

    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);

    // Jumped across features: breadcrumb and URL both show the new page.
    await expect(page.getByTestId('pe-breadcrumb')).toContainText('billing');
    await expect(page.getByTestId('pe-breadcrumb')).toContainText('InvoicePage.tsx');
    await expect(page).toHaveURL(/feature=billing.*file=InvoicePage\.tsx|file=InvoicePage\.tsx.*feature=billing/);
  });
});
