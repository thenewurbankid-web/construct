import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #273 (part of #243) — the top bar has to stay readable on a 1280x720 laptop.
// It did not: flexbox shrank the status pills and the pane toggles below their
// own content width, so "Processes: 0" and "Ctrl K" wrapped onto a second line
// inside a 24px pill and the Browser / Tools labels overflowed their borders
// and appeared to touch. These checks measure the real rendered boxes rather
// than comparing pixels, so they fail on the actual defect (a squashed or
// overlapping control) and not on an unrelated restyle.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots/shell-states');
fs.mkdirSync(SHOTS, { recursive: true });

const MIN_GAP = 8; // --sp-2, the gap declared on .sh-top
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

// The bar has to hold up under its *worst* case, not the case where the
// current project happens to be called "construct". The reported defect
// (see the demo screenshot on #273) was on a project named
// "construct-demo-create-qV...", i.e. with the project button at its
// max-width, and with the longest model status showing. Both are pinned here
// so the check is deterministic rather than dependent on whatever folder the
// developer running it last opened.
const LONG_PROJECT = 'construct-demo-create-a-long-project-name';

/** Every directly-laid-out control in the top bar, with its rendered box and
 * the width/height its own content actually needs. */
const measureTopBar = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.sh-top');
    const controls = bar.querySelectorAll(
      '.sh-brand, .sh-project-btn, .sh-modes, .sh-palette-trigger, .sh-pill, .sh-icon-btn',
    );
    return {
      bar: bar.getBoundingClientRect().toJSON(),
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      controls: [...controls].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name:
            el.dataset.testid ||
            el.className.split(' ')[0] ||
            (el.textContent || '').trim().slice(0, 20),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          // scrollWidth/Height exceed clientWidth/Height exactly when the
          // content does not fit the box (i.e. the control was squashed).
          overflowsX: el.scrollWidth > Math.ceil(el.clientWidth) + 1,
          overflowsY: el.scrollHeight > Math.ceil(el.clientHeight) + 1,
        };
      }),
    };
  });

// Longest model status, so the model pill is measured at its widest.
const pinOffline = (page) =>
  page.route('**/api/ollama/status', (route) => route.fulfill({ json: { running: false } }));

let base;
let originalProjectDir;

test.beforeAll(async ({ request }) => {
  originalProjectDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-topbar-')));
  const dir = path.join(base, LONG_PROJECT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\n');
  const res = await request.post(`${API}/api/settings`, { data: { projectDir: dir } });
  expect(res.ok()).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  await request.post(`${API}/api/settings`, { data: { projectDir: originalProjectDir } });
  fs.rmSync(base, { recursive: true, force: true });
});

for (const [name, width, height] of [
  ['1280', 1280, 720],
  ['1024', 1024, 768],
]) {
  test.describe.serial(`top bar density at ${width}px (#273)`, () => {
    test.use({ viewport: { width, height } });

    test('no control is squashed, every gap is at least 8px, and the bar does not overflow', async ({ page }) => {
      await pinOffline(page);
      await page.goto('/help');
      await expect(page.getByTestId('project-switcher')).toContainText(LONG_PROJECT);
      await expect(page.getByTestId('pill-processes')).toBeVisible();
      const { bar, docScrollWidth, innerWidth, controls } = await measureTopBar(page);

      // The page itself must not gain a horizontal scrollbar because of the bar.
      expect(docScrollWidth).toBeLessThanOrEqual(innerWidth);

      // Nothing sticks out of the bar on either side.
      for (const c of controls) {
        expect(c.x, `${c.name} starts before the bar`).toBeGreaterThanOrEqual(bar.x - 0.5);
        expect(c.x + c.width, `${c.name} runs past the end of the bar`).toBeLessThanOrEqual(
          bar.x + bar.width + 0.5,
        );
      }

      // The squash test: a control whose content does not fit its box is the
      // exact defect in #273 (overflowing text reads as "the buttons touch").
      for (const c of controls) {
        expect(c.overflowsX, `${c.name} ("${c.text}") is narrower than its content`).toBe(false);
        expect(c.overflowsY, `${c.name} ("${c.text}") wraps onto a second line`).toBe(false);
      }

      // The pills and toggles are single-line: 44px bar, so anything taller
      // than ~30px has wrapped.
      for (const c of controls) {
        expect(c.height, `${c.name} is taller than one line`).toBeLessThanOrEqual(30);
      }

      // Adjacent controls keep the declared 8px gap.
      const row = [...controls].sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i += 1) {
        const prev = row[i - 1];
        const cur = row[i];
        const gap = cur.x - (prev.x + prev.width);
        expect(gap, `gap between ${prev.name} and ${cur.name}`).toBeGreaterThanOrEqual(MIN_GAP - 0.5);
      }

      await page.screenshot({
        path: path.join(SHOTS, `topbar-${name}-dark.png`),
        clip: { x: 0, y: 0, width, height: 44 },
      });
      await page.screenshot({ path: path.join(SHOTS, `topbar-${name}-full-dark.png`) });
    });

    test('the collapsed pills keep their words for assistive tech and on hover', async ({ page }) => {
      await page.route('**/api/ollama/status', (route) => route.fulfill({ json: { running: true, version: '0.3.12' } }));
      await page.goto('/help');

      // Visually collapsed to icon + count. The label is clipped to 1x1px
      // rather than display:none, so measure it instead of asking Playwright
      // for visibility (a 1px box still counts as visible).
      const label = page.getByTestId('pill-processes').locator('.sh-pill-text');
      expect((await label.boundingBox()).width).toBeLessThanOrEqual(2);
      const modelLabel = page.getByTestId('pill-model').locator('.sh-pill-text');
      expect((await modelLabel.boundingBox()).width).toBeLessThanOrEqual(2);
      await expect(page.getByTestId('pill-processes').locator('.sh-pill-count')).toHaveText('0');

      // ...but the accessible name, the text content and the title survive.
      await expect(page.getByTestId('pill-processes')).toHaveText('Processes: 0');
      await expect(page.getByTestId('pill-processes')).toHaveAttribute(
        'title',
        'Running processes - open the Processes drawer',
      );
      await expect(page.getByTestId('pill-model')).toHaveText('Local model ready');
      await expect(page.getByTestId('pill-model')).toHaveAttribute('title', 'Local model ready');

      // And it still does its job.
      await page.getByTestId('pill-processes').click();
      await expect(page.getByRole('region', { name: 'Drawer' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Processes' })).toHaveAttribute('aria-selected', 'true');
    });
  });
}

// Above the dense tier the words come back — the collapse is a response to the
// width, not a permanent downgrade.
test.describe('top bar at 1440px (#273)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the pill labels are visible again and nothing is squashed', async ({ page }) => {
    await pinOffline(page);
    await page.goto('/help');
    expect((await page.getByTestId('pill-processes').locator('.sh-pill-text').boundingBox()).width).toBeGreaterThan(40);
    expect((await page.getByTestId('pill-model').locator('.sh-pill-text').boundingBox()).width).toBeGreaterThan(40);
    const { controls, docScrollWidth, innerWidth } = await measureTopBar(page);
    expect(docScrollWidth).toBeLessThanOrEqual(innerWidth);
    for (const c of controls) {
      expect(c.overflowsX, `${c.name} ("${c.text}") is narrower than its content`).toBe(false);
      expect(c.overflowsY, `${c.name} ("${c.text}") wraps onto a second line`).toBe(false);
    }
    await page.screenshot({
      path: path.join(SHOTS, 'topbar-1440-dark.png'),
      clip: { x: 0, y: 0, width: 1440, height: 44 },
    });
  });
});
