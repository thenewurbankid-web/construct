import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #679 -- the Page Builder (Craft.js) end to end in a real browser: drag blocks from the toolbox onto the canvas,
// edit one in the settings panel, export the layout as TSX, and keep it across a reload through Save / Load.
test.describe('Page Builder (#679)', () => {
  test.beforeAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
  });

  test('drag Heading and Button in, rename the button, export TSX with its own handler; save and load it back', async ({ page }) => {
    await gotoCockpit(page, '/builder');
    const canvas = page.getByTestId('pb-canvas');
    const root = canvas.getByTestId('pb-container').first();
    await expect(root).toBeVisible();

    await page.getByTestId('pb-tool-heading').dragTo(root);
    await expect(canvas.getByTestId('pb-heading')).toHaveCount(1);
    await page.getByTestId('pb-tool-button').dragTo(root);
    await expect(canvas.getByTestId('pb-button')).toHaveCount(1);

    await canvas.getByTestId('pb-button').click();
    await expect(page.getByTestId('pb-settings')).toContainText('Button');
    await page.getByTestId('pb-field-label').fill('Add category');
    await expect(canvas.getByTestId('pb-button')).toHaveText('Add category');

    await page.getByTestId('pb-export').click();
    const code = page.getByTestId('pb-export-code');
    await expect(code).toContainText('export default function Demo(');
    await expect(code).toContainText('onAddCategory');
    await expect(code).toContainText('type DemoProps = {');
    await expect(code).toContainText('<h2>Heading</h2>');
    await page.getByTestId('pb-export-close').click();
    await expect(page.getByTestId('pb-export-panel')).toHaveCount(0);

    await page.getByTestId('pb-save').click();
    await expect(page.getByTestId('pb-status')).toContainText('Saved "Demo"');
    await page.reload();
    await expect(canvas.getByTestId('pb-button')).toHaveCount(0);
    await page.getByTestId('pb-load').click();
    await expect(page.getByTestId('pb-status')).toContainText('Loaded "Demo"');
    await expect(canvas.getByTestId('pb-heading')).toHaveCount(1);
    await expect(canvas.getByTestId('pb-button')).toHaveText('Add category');
  });
});
