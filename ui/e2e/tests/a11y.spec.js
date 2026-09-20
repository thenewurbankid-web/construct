import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAxe, isBlocking, format } from './support/axe.js';

// Design #261 -- axe accessibility pass over every Cockpit screen, both themes,
// wide (1280) and narrow (390), plus the drawer and command palette open.
// Serious/critical violations FAIL; moderate/minor are collected and written to
// $A11Y_REPORT (if set) so they can be tracked.
const SCREENS = ['/dashboard', '/wizard', '/pages', '/workflows', '/tests', '/ollama', '/settings', '/help', '/states'];
const VIEWPORTS = { wide: { width: 1280, height: 800 }, narrow: { width: 390, height: 800 } };
const THEMES = ['dark', 'light'];
const lesser = [];

test.afterAll(() => {
  if (process.env.A11Y_REPORT) fs.writeFileSync(process.env.A11Y_REPORT, JSON.stringify(lesser, null, 1));
});

async function check(page, label) {
  const found = await runAxe(page);
  for (const v of found.filter((x) => !isBlocking(x))) lesser.push({ label, ...v });
  expect(found.filter(isBlocking), `${label}\n${format(found.filter(isBlocking))}`).toEqual([]);
}

// Click through every enabled tab and scan after each. Tab labels are captured up
// front (narrow mode swaps whole panes when a "Panes" tab is clicked, so DOM
// indices shift). Disabled tabs (nothing open yet) are skipped.
async function scanTabs(page, label, exceptList) {
  const names = await page.evaluate((except) => {
    const out = [];
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      if (except && list.getAttribute('aria-label') === except) continue;
      if (!list.offsetParent) continue;
      for (const t of list.querySelectorAll('[role="tab"]')) if (!t.disabled) out.push({ list: list.getAttribute('aria-label'), name: t.textContent.trim() });
    }
    return out;
  }, exceptList);
  let n = 0;
  for (const { list, name } of names) {
    const tab = page.getByRole('tablist', { name: list }).getByRole('tab', { name, exact: true }).first();
    if (!(await tab.isVisible()) || !(await tab.isEnabled())) continue;
    await tab.click();
    await page.waitForTimeout(150);
    await check(page, `${label} tab "${list} > ${name}"`);
    n++;
  }
  return n;
}

async function scanAllTabs(page, label) {
  const paneBar = page.getByRole('tablist', { name: 'Panes' });
  if (!(await paneBar.count())) return scanTabs(page, label);
  let n = 0;
  const panes = await paneBar.getByRole('tab').allTextContents();
  for (const p of panes) {
    await page.getByRole('tablist', { name: 'Panes' }).getByRole('tab', { name: p.trim(), exact: true }).click();
    await page.waitForTimeout(150);
    await check(page, `${label} pane "${p.trim()}"`);
    n += 1 + (await scanTabs(page, `${label} pane "${p.trim()}"`, 'Panes'));
  }
  return n;
}

for (const theme of THEMES) {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    test.describe(`${theme} ${vp}`, () => {
      test.use({ viewport: size });
      test.beforeEach(async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
      });
      for (const route of SCREENS) {
        test(`${route}`, async ({ page }) => {
          await page.goto(route);
          await expect(page.locator('h1, h2').first()).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
          await page.waitForTimeout(400);
          await check(page, `${route} ${theme} ${vp}`);
        });
      }
      // Every side-pane and tab: click through each tab of each tablist (Browser,
      // Tools, drawer...) and scan, so hidden tab panels are covered too.
      for (const route of ['/pages', '/workflows', '/dashboard']) {
        test(`${route} all panes and tabs`, async ({ page }) => {
          await gotoCockpit(page, route);
          await expect(page.locator('h1, h2').first()).toBeVisible();
          if (vp === 'wide') {
            await page.keyboard.press('Control+j');
            await expect(page.getByRole('region', { name: 'Drawer' })).toBeVisible();
          }
          const scanned = await scanAllTabs(page, `${route} ${theme} ${vp}`);
          expect(scanned).toBeGreaterThan(0);
        });
      }
      test('project switcher popover open', async ({ page }) => {
        await page.goto('/help');
        await page.getByTestId('project-switcher').click();
        await expect(page.getByRole('dialog', { name: 'Switch project' })).toBeVisible();
        await check(page, `project switcher ${theme} ${vp}`);
      });
      test('drawer open', async ({ page }) => {
        test.skip(vp === 'narrow', 'the drawer is not shown at narrow widths by design (ShellLayout)');
        await gotoCockpit(page, '/help');
        await page.keyboard.press('Control+j');
        await expect(page.getByRole('region', { name: 'Drawer' })).toBeVisible();
        await check(page, `drawer ${theme} ${vp}`);
      });
      test('command palette open', async ({ page }) => {
        await gotoCockpit(page, '/help');
        await page.keyboard.press('Control+k');
        await expect(page.getByRole('dialog')).toBeVisible();
        await check(page, `palette ${theme} ${vp}`);
      });
    });
  }
}

// Screens with real content: a temp project with a page open in the Pages editor,
// the Workflows diagram, and Diagnostics rows (a page importing a hook) in the drawer.
test.describe.serial('screens with real project content', () => {
  const API = process.env.E2E_API_BASE || 'http://localhost:4000';
  const PAGE_SRC = `import React, { useState } from 'react';
import { useThing } from '../hooks/useThing';
import { gotoCockpit } from './support/cockpit.js';

export default function LoginPage({ title }: { title: string }) {
  const [email, setEmail] = useState('');
  useThing();
  return (
    <main>
      <h1>{title}</h1>
      <form onSubmit={() => setEmail('')}>
        <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" disabled={!email}>Sign in</button>
      </form>
    </main>
  );
}
`;
  let dir;
  let original;

  test.beforeAll(async ({ request }) => {
    original = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-a11y-')));
    await request.post(`${API}/api/settings`, { data: { browseRoots: [dir], projectDir: dir } });
    await request.post(`${API}/api/init`);
    await request.post(`${API}/api/create`, { data: { kind: 'single', name: 'Login', feature: 'auth', layer: 'page' } });
    fs.mkdirSync(path.join(dir, 'features/auth/hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'features/auth/hooks/useThing.tsx'), 'export function useThing() { return 1; }\n');
    fs.writeFileSync(path.join(dir, 'features/auth/pages/LoginPage.tsx'), PAGE_SRC);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { browseRoots: [], projectDir: original } });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const theme of THEMES) {
    for (const [vp, size] of Object.entries(VIEWPORTS)) {
      test(`${theme} ${vp}: pages editor with a file open, every tab; workflows; diagnostics`, async ({ page }) => {
        await page.setViewportSize(size);
        await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
        await page.goto('/pages?feature=auth&file=LoginPage.tsx');
        await expect(page.locator('.tree-panel')).toBeAttached({ timeout: 20_000 }); // at 390px it sits in a non-active pane
        await page.waitForTimeout(500);
        await check(page, `pages+file ${theme} ${vp}`);
        await scanAllTabs(page, `pages+file ${theme} ${vp}`);
        await page.goto('/workflows');
        await expect(page.locator('h1, h2').first()).toBeVisible();
        await page.waitForTimeout(800);
        await check(page, `workflows+project ${theme} ${vp}`);
        await gotoCockpit(page, '/dashboard');
        await expect(page.locator('h1, h2').first()).toBeVisible();
        await check(page, `dashboard+project ${theme} ${vp}`);
        if (vp === 'wide') {
          await page.keyboard.press('Control+j');
          const drawer = page.getByRole('region', { name: 'Drawer' });
          await expect(drawer.getByTestId('diagnostic-row').first()).toBeVisible({ timeout: 30_000 });
          await check(page, `diagnostics rows ${theme}`);
        }
      });
    }
  }
});

test.describe('keyboard-only flow', () => {
  test.use({ viewport: VIEWPORTS.wide });
  test('Tab reaches the top bar then panes with a visible focus ring; palette and drawer open by shortcut; F6 cycles panes', async ({ page }) => {
    await gotoCockpit(page, '/help');
    await expect(page.locator('h1')).toBeVisible();
    const seen = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return null;
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return {
          name: e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 30) || e.tagName,
          top: r.top,
          visible: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none',
        };
      });
      if (info) seen.push(info);
    }
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.filter((s) => !s.visible).map((s) => s.name)).toEqual([]);
    // Top bar controls come before pane content in tab order.
    expect(seen[0].top).toBeLessThan(60);

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Control+j');
    await expect(page.getByRole('region', { name: 'Drawer' })).toBeVisible();
    await page.keyboard.press('Control+j');

    const focusedPane = () => page.evaluate(() => {
      const e = document.activeElement;
      const r = e && e.closest('[role="region"],[role="navigation"],[role="main"],main,nav,aside,[role="complementary"]');
      return r ? (r.getAttribute('aria-label') || r.tagName) : null;
    });
    const panes = new Set();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('F6');
      panes.add(await focusedPane());
    }
    expect(panes.size).toBeGreaterThan(1);
  });
});
