import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForCockpitReady } from './support/cockpit.js';

// #298 - both top-bar popovers (the project switcher and the account chip) follow ONE dismissal contract
// (docs/design/popovers.md): focus moves in on open; Escape closes and returns focus to the trigger; an outside
// click closes WITHOUT stealing focus; Tab past either end closes and moves on; opening one closes the other;
// the trigger carries aria-expanded + aria-controls. Popovers are not modals, so nothing here asserts a trap.
//
// The account chip only exists when the server has a login gate. Run this spec in both postures:
//   default config          -> the project switcher (chip tests skip)
//   playwright.auth.config  -> both popovers, including "opening one closes the other"
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots/popover-dismiss');
fs.mkdirSync(SHOTS, { recursive: true });

const POPOVERS = {
  switcher: { name: 'project switcher', trigger: 'project-switcher', surface: 'sh-project-popover' },
  account: { name: 'account chip', trigger: 'user-menu-trigger', surface: 'sh-user-menu' },
};

async function openCockpit(page) {
  await page.goto('/dashboard');
  const login = page.getByTestId('login-test-user');
  if (await login.isVisible().catch(() => false)) await login.click();
  await waitForCockpitReady(page);
  // The account chip renders only once the session has loaded; give it a moment before deciding it is absent.
  await page.waitForTimeout(300);
}

const insideSurface = (page, surface) =>
  page.evaluate((id) => !!document.getElementById(id)?.contains(document.activeElement), surface);

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// The project switcher's body is the folder picker, which lists directories asynchronously: for the first
// moments (seconds, on a large project) the panel says "Loading folders..." and has NO controls, while focus
// sits on the dialog itself. A test that picks "the last control" before then indexes an empty list. Wait for
// at least one enabled control to exist.
async function controlsReady(page, surface) {
  await expect
    .poll(() =>
      page.evaluate(
        ([id, sel]) => [...(document.getElementById(id)?.querySelectorAll(sel) ?? [])].filter((e) => !e.disabled).length,
        [surface, FOCUSABLE],
      ),
    )
    .toBeGreaterThan(0);
}

for (const key of Object.keys(POPOVERS)) {
  const p = POPOVERS[key];
  test.describe(`popover contract: ${p.name}`, () => {
    let trigger;
    test.beforeEach(async ({ page }) => {
      await openCockpit(page);
      trigger = page.getByTestId(p.trigger);
      test.skip((await trigger.count()) === 0, `${p.name} is not present in this server posture`);
    });

    test('the trigger names what it controls and reports its state', async ({ page }) => {
      await expect(trigger).toHaveAttribute('aria-controls', p.surface);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`#${p.surface}`)).toBeVisible();
      // One surface: every popover wears .sh-popover (the old .sh-user-menu is gone).
      await expect(page.locator(`#${p.surface}`)).toHaveClass(/\bsh-popover\b/);
    });

    test('focus moves into the popover on open (mouse and keyboard)', async ({ page }) => {
      await trigger.click();
      await expect(page.locator(`#${p.surface}`)).toBeVisible();
      await expect.poll(() => insideSurface(page, p.surface)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(() => insideSurface(page, p.surface)).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `${key}-open-focus-in.png`), clip: { x: 0, y: 0, width: 1280, height: 420 } });
    });

    test('Escape closes and returns focus to the trigger', async ({ page }) => {
      await trigger.click();
      await expect.poll(() => insideSurface(page, p.surface)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator(`#${p.surface}`)).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test('an outside click closes it without stealing focus', async ({ page }) => {
      await trigger.click();
      await expect(page.locator(`#${p.surface}`)).toBeVisible();
      const target = page.getByTestId('toggle-right');
      await target.click();
      await expect(page.locator(`#${p.surface}`)).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      // Focus stays where the click landed, not yanked back to the trigger.
      await expect(target).toBeFocused();
      await expect(trigger).not.toBeFocused();
    });

    test('an outside click on plain page area also closes it', async ({ page }) => {
      await trigger.click();
      await expect(page.locator(`#${p.surface}`)).toBeVisible();
      await page.mouse.click(640, 700);
      await expect(page.locator(`#${p.surface}`)).toHaveCount(0);
      await expect(trigger).not.toBeFocused();
    });

    test('Tab past the last control closes it and moves on (no trap)', async ({ page }) => {
      await trigger.click();
      await expect.poll(() => insideSurface(page, p.surface)).toBe(true);
      await controlsReady(page, p.surface);
      await page.evaluate(([id, sel]) => {
        const els = [...document.getElementById(id).querySelectorAll(sel)].filter((e) => !e.disabled);
        els[els.length - 1].focus();
      }, [p.surface, FOCUSABLE]);
      await page.keyboard.press('Tab');
      await expect(page.locator(`#${p.surface}`)).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      // Focus continued onward: it is neither back on the trigger nor lost.
      await expect(trigger).not.toBeFocused();
      expect(await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body)).toBe(true);
    });

    test('Shift+Tab before the first control closes it', async ({ page }) => {
      await trigger.click();
      await expect.poll(() => insideSurface(page, p.surface)).toBe(true);
      await controlsReady(page, p.surface);
      await page.evaluate(([id, sel]) => {
        const els = [...document.getElementById(id).querySelectorAll(sel)].filter((e) => !e.disabled);
        els[0].focus();
      }, [p.surface, FOCUSABLE]);
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator(`#${p.surface}`)).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });
}

test('opening one popover closes the other', async ({ page }) => {
  await openCockpit(page);
  const sw = page.getByTestId(POPOVERS.switcher.trigger);
  const acct = page.getByTestId(POPOVERS.account.trigger);
  test.skip((await acct.count()) === 0, 'no login gate in this posture, so there is only one popover');
  await sw.click();
  await expect(page.locator(`#${POPOVERS.switcher.surface}`)).toBeVisible();
  await acct.click();
  await expect(page.locator(`#${POPOVERS.account.surface}`)).toBeVisible();
  await expect(page.locator(`#${POPOVERS.switcher.surface}`)).toHaveCount(0);
  await expect(sw).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: path.join(SHOTS, 'account-open-switcher-closed.png'), clip: { x: 0, y: 0, width: 1280, height: 200 } });
  await sw.click();
  await expect(page.locator(`#${POPOVERS.switcher.surface}`)).toBeVisible();
  await expect(page.locator(`#${POPOVERS.account.surface}`)).toHaveCount(0);
  await expect(acct).toHaveAttribute('aria-expanded', 'false');
});
