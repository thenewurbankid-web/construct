import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit, setTheme } from './support/cockpit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #375 acceptance: "Layout matches ia-pages in both themes (dark and light)". The aspirational
// mock (docs/design/mocks/ia-pages.html) also shows content from later slices (#378-381: a
// running dev server, tree chips, overlay data) not built yet -- this spec covers what #375
// actually ships: the stage's own chrome (tab strip, breadcrumb, Overlays menu, Pick) renders
// correctly, with real theme tokens (not hardcoded colours), in both themes.
const FIXTURE_PAGE = `export default function LoginForm({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <form>
        <input value="" onChange={() => {}} />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
`;

test.describe.serial('Pages Editor: theme parity (#375)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-pe-theme-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Login', feature: 'auth', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/auth/pages/LoginForm.tsx'), FIXTURE_PAGE);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-theme-{dark,light}.png — stage chrome (tabs, breadcrumb, Overlays, Pick) themes correctly in both', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await page.locator('.pages-browser select').selectOption('auth');
    await page.getByRole('button', { name: 'LoginForm.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    const overlaysMenu = page.locator('.overlays-menu > summary');
    await overlaysMenu.click();
    await page.getByLabel('Flow').check();
    await expect(page.locator('.propflow-svg')).toBeVisible();

    const readColors = () =>
      page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const crumb = document.querySelector('.pe-breadcrumb');
        return { bg: body.backgroundColor, text: body.color, crumb: crumb ? getComputedStyle(crumb).color : null };
      });

    await setTheme(page, 'dark');
    await expect(page.locator('.pe-breadcrumb')).toContainText('LoginForm.tsx');
    await expect(overlaysMenu).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open source' })).toBeVisible();
    const dark = await readColors();
    await page.screenshot({ path: path.join(SHOTS, 'pages-editor-theme-dark.png'), fullPage: true });

    await setTheme(page, 'light');
    await expect(page.locator('.pe-breadcrumb')).toContainText('LoginForm.tsx');
    await expect(overlaysMenu).toBeVisible();
    const light = await readColors();
    await page.screenshot({ path: path.join(SHOTS, 'pages-editor-theme-light.png'), fullPage: true });

    // Not just "the theme attribute flipped" — the actual rendered colours differ, proving the
    // stage's own chrome (added across this ticket's slices) reads real theme tokens, not a
    // value baked in once at first paint.
    expect(dark.bg).not.toBe(light.bg);
    expect(dark.text).not.toBe(light.text);
    expect(dark.crumb).not.toBe(light.crumb);
  });
});
