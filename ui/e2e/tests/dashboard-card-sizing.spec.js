import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #163 — `.dashboard-grid`'s default `align-items: stretch` forced every
// card in a row to match its row's tallest sibling (Refactor/Import, which
// have more fields by default), leaving dead space below Create/Research's
// shorter content. `align-items: start` (app/globals.css) lets each card
// size to its own content. This test proves Create's rendered box height is
// now close to its own content, not stretched to Refactor's height.
test.describe('Dashboard card sizing (#163)', () => {
  test.beforeAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
  });

  test('1. dashboard-card-sizing.png — Create card is not stretched to Refactor card\'s height', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toHaveText('Dashboard');

    const createCard = page.locator('.command-form', { hasText: 'Create' });
    const refactorCard = page.locator('.command-form', { hasText: 'Refactor' });
    await expect(createCard).toBeVisible();
    // #391: Refactor, Research and Import start collapsed under "More actions"; open it to compare the cards.
    await page.locator('.dashboard-more > summary').click();
    await expect(refactorCard).toBeVisible();

    const createBox = await createCard.boundingBox();
    const refactorBox = await refactorCard.boundingBox();
    expect(createBox).not.toBeNull();
    expect(refactorBox).not.toBeNull();

    // Refactor has strictly more fields than Create's default view, so it's
    // taller in absolute terms — the bug was Create being stretched to
    // *match* it exactly regardless of its own content. Require a real,
    // visible difference instead of near-equal heights.
    expect(refactorBox.height - createBox.height).toBeGreaterThan(40);

    await page.locator('.page--screen').screenshot({ path: path.join(SCREENSHOTS_DIR, 'dashboard-card-sizing.png') });
  });

  test('2. #391: Create is open, Refactor / Research / Import wait under a collapsed "More actions", with plain copy', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toHaveText('Dashboard');
    await expect(page.getByRole('heading', { name: 'Create', level: 3 })).toBeVisible();
    const more = page.locator('.dashboard-more');
    await expect(more.locator('summary')).toHaveText('More actions');
    await expect(more).not.toHaveAttribute('open', '');
    for (const name of ['Refactor', 'Research', 'Import an existing file']) {
      await expect(page.getByRole('heading', { name, level: 3 })).toBeHidden();
    }
    // Plain words: no CLI-named lede, no "(all 7 layer folders)", the layer-order sentence is a tooltip.
    await expect(page.getByText("CLI's create/refactor")).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'A new feature', exact: true })).toHaveCount(1);
    await expect(page.getByText('regardless of the order checked')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create feature' })).toBeVisible();

    await more.locator('summary').click();
    await expect(page.getByRole('heading', { name: 'Refactor', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Research', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import an existing file', level: 3 })).toBeVisible();
    // The Import card's redirect is a link to the wizard, not prose.
    await expect(more.getByRole('link', { name: 'Import Wizard' })).toHaveAttribute('href', '/wizard');
  });
});
