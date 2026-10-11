import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';

// Line hour 2: Components -> Library for a `preset: line` project (examples/line-sample): the library's components
// as cards grouped Atoms / Molecules / Organisms with how many feature components are based on each, then each
// feature's components with their base link. A non-Line project keeps today's Components screen.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const group = (page, level) => page.getByTestId(`ll-group-${level}`);
const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });
const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });

test.describe.serial('Line Components library (Line sample project)', () => {
  failOnConsoleErrors(test);
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('the library shows as cards by level with base counts; feature components show their base link', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await expect(page.getByRole('heading', { level: 1, name: 'Your component library' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ll-total')).toHaveText('4');

    // Groups in order, each with its cards.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([/^Plan/, /^Atoms/, /^Molecules/, /^Organisms/, /^Feature components/]);
    await expect(group(page, 'atom').getByTestId('ll-card')).toHaveCount(2);
    await expect(group(page, 'molecule').getByTestId('ll-card')).toHaveCount(1);
    await expect(group(page, 'organism').getByTestId('ll-card')).toHaveCount(1);
    for (const [name, level, used] of [
      ['Badge', 'Atom', 'Not used by any feature yet'],
      ['Button', 'Atom', 'Used by 1 feature component'],
      ['Card', 'Molecule', 'Used by 1 feature component'],
      ['DataTable', 'Organism', 'Not used by any feature yet'],
    ]) {
      const c = card(page, name);
      await expect(c).toBeVisible();
      await expect(c).toContainText(level);
      await expect(c.getByTestId('ll-used-by')).toHaveText(used);
    }

    // Feature components under their feature, with their base link; the problem says why in plain English.
    await expect(page.getByTestId('ll-feature').locator('h3')).toHaveText(['billing', 'orders']);
    await expect(featureRow(page, 'OrderButton').getByTestId('ll-base')).toHaveText('Based on Button');
    await expect(featureRow(page, 'OrderCard').getByTestId('ll-base')).toHaveText('Based on Card');
    const invoice = featureRow(page, 'InvoiceCard');
    await expect(invoice.getByTestId('ll-base')).toHaveText('No library base yet');
    await expect(invoice).toHaveAttribute('data-problem', 'true');
    await expect(invoice.getByText(/has no library base; add one "@line-base components\/<Name>" comment/)).toBeVisible();
    // The rule id waits under Details.
    await expect(invoice.getByText('LINE-BASE', { exact: true })).toBeHidden();
    await invoice.getByText('Details', { exact: true }).click();
    await expect(invoice.getByText('LINE-BASE', { exact: true })).toBeVisible();

    const found = await runAxe(page, { include: '[data-testid="line-library"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('a library card\'s Preview renders that component alone with its props; changing a prop renders it again', async ({ page }) => {
    test.setTimeout(90_000); // the first render bundles the component with esbuild
    const BUTTON = 'library/components/Button.tsx';
    const answer = await (await fetch(`${API}/api/line/render?file=${encodeURIComponent(BUTTON)}`)).json().catch(() => null);
    await gotoCockpit(page, '/components');
    const button = card(page, 'Button');
    await expect(button).toBeVisible({ timeout: 30_000 });
    // Nothing renders until the person opens the preview.
    await expect(page.getByTestId('line-component-preview')).toHaveCount(0);
    await button.getByText('Preview Button', { exact: true }).click();
    const panel = button.getByTestId('line-component-preview');
    await expect(panel).toBeVisible();
    const props = panel.getByRole('list', { name: 'Props of Button' });
    await expect(props.getByTestId('lr-prop')).toHaveCount(1, { timeout: 30_000 });
    const label = props.locator('[data-prop="label"]');
    await expect(label).toContainText('string');

    if (answer?.code === 'NO_RENDERER') {
      // No Morpheus link on this machine: one sentence instead of a picture, and the card still works.
      await expect(panel.getByTestId('lr-no-picture')).toContainText('There is no picture of Button');
    } else {
      const inside = page.frameLocator('[data-testid="ll-card"] [data-testid="lr-frame"]');
      await expect(inside.getByRole('button', { name: 'Label' })).toBeVisible({ timeout: 30_000 });
      await label.getByLabel('label').fill('Buy now');
      await expect(inside.getByRole('button', { name: 'Buy now' })).toBeVisible({ timeout: 15_000 });
    }
    const found = await runAxe(page, { include: '[data-testid="line-library"]', exclude: ['[data-testid="lr-frame"]'] });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    // Closing it takes the preview away again.
    await button.getByText('Preview Button', { exact: true }).click();
    await expect(page.getByTestId('line-component-preview')).toHaveCount(0);
  });
});

test.describe.serial('Components screen for a non-Line project is unchanged', () => {
  failOnConsoleErrors(test);
  let project;
  let restore;
  test.beforeAll(async () => {
    project = makeBrowseProject('line-nonline-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('a non-Line project still lists its components in the Browser, with no Line library', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await expect(page.getByTestId('components-pick')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('listbox', { name: 'Components' }).getByRole('option').first()).toBeVisible();
    await expect(page.getByTestId('line-library')).toHaveCount(0);
  });
});
