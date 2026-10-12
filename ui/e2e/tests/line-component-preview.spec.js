import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors, refusalOf } from './support/consoleGuard.js';
import { startUnderTheHood } from './support/lineModes.js';

// Two modes: this spec checks the screen's regular view, so it starts Under the hood (screens open in Chat by default).
startUnderTheHood(test);

// Line Cockpit T7 (owner's win 3): "click a library component and see it rendered with its props". A copy of
// examples/line-sample is opened in the real server; /components/preview?file= renders the library Button alone through
// GET /api/line/render (Morpheus's isolated render through packages/line-links). When this machine has no Morpheus link
// the panel must say so in one sentence and still list the props; that case is checked instead of the picture.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const BUTTON = 'library/components/Button.tsx';

test.describe('Line component preview (Line sample project)', () => {
  // A file outside library/components is refused on purpose.
  failOnConsoleErrors(test, { allow: [refusalOf('/api/line/render')] });
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

  test('the library Button renders alone with its props listed; changing the label re-renders it; axe clean', async ({ page }) => {
    test.setTimeout(90_000); // the first render bundles the component with esbuild; the first visit compiles the route
    const answer = await (await fetch(`${API}/api/line/render?file=${encodeURIComponent(BUTTON)}`)).json().catch(() => null);
    await gotoCockpit(page, `/components/preview?file=${encodeURIComponent(BUTTON)}`);
    const panel = page.getByTestId('line-component-preview');
    await expect(page.getByRole('heading', { name: 'Button', level: 1 })).toBeVisible();
    const props = panel.getByRole('list', { name: 'Props of Button' });
    await expect(props.getByTestId('lr-prop')).toHaveCount(1, { timeout: 30_000 });
    const label = props.locator('[data-prop="label"]');
    await expect(label).toContainText('label');
    await expect(label).toContainText('string');

    if (answer?.code === 'NO_RENDERER') {
      // No Morpheus link on this machine: one sentence, the rest of Cockpit keeps working.
      await expect(panel.getByTestId('lr-no-picture')).toContainText("There is no picture of Button because Morpheus's renderer is not linked here");
      return;
    }

    const frame = panel.getByTestId('lr-frame');
    await expect(frame).toHaveAttribute('sandbox', '');
    const inside = page.frameLocator('[data-testid="lr-frame"]');
    await expect(inside.getByRole('button', { name: 'Label' })).toBeVisible();
    await expect(label.getByLabel('label')).toHaveValue('Label');

    await label.getByLabel('label').fill('Buy now');
    await expect(inside.getByRole('button', { name: 'Buy now' })).toBeVisible({ timeout: 15_000 });
    await expect(inside.getByRole('button', { name: 'Label' })).toHaveCount(0);

    // The frame's content is the project's own component, not Cockpit's markup (and its sandbox runs no scripts, so axe
    // cannot be injected into it); the frame element itself, with its title, is still checked.
    const found = await runAxe(page, { include: '[data-testid="line-preview-page"]', exclude: ['[data-testid="lr-frame"]'] });
    await expect(frame).toHaveAttribute('title', 'Button rendered alone');
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('a file outside library/components is refused with one sentence and no picture', async ({ page }) => {
    await gotoCockpit(page, `/components/preview?file=${encodeURIComponent('features/orders/components/OrderButton.tsx')}`);
    await expect(page.getByTestId('lr-refused')).toHaveText('Only components in library/components/ can be previewed here, so "features/orders/components/OrderButton.tsx" is not shown.');
    await expect(page.getByTestId('lr-frame')).toHaveCount(0);
  });
});
