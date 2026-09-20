import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Login hero (owner request 2026-09-20): the login screen is a full-screen, crossfading slideshow of real
// Cockpit screens with a small typed, changing one-liner and the Cockpit mark. Runs against the auth-armed
// server (playwright.auth.config.js), signed out, so the real login screen is what is on screen.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test('the login screen has a full-screen slideshow, the logo, and a typed tagline that keeps changing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const screen = page.getByTestId('login-screen');
  await expect(screen).toBeVisible();

  // The Cockpit mark and name.
  const brand = page.getByTestId('login-brand');
  await expect(brand).toContainText('Cockpit');
  await expect(brand.locator('svg')).toHaveCount(1);

  // Full-screen backdrop: fixed, covering the viewport, six slides, hidden from assistive tech.
  const backdrop = page.getByTestId('login-backdrop');
  await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  const box = await backdrop.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(1440);
  expect(box.height).toBeGreaterThanOrEqual(900);
  await expect(backdrop.locator('.login-backdrop__slide')).toHaveCount(6);

  // Slides crossfade: over a few seconds a different slide becomes the visible one, and the sum of the
  // slide opacities never drops below 1 (no dip to the background).
  const opacities = () => backdrop.locator('.login-backdrop__slide').evaluateAll((els) => els.map((e) => +getComputedStyle(e).opacity));
  const first = await opacities();
  let changed = false;
  let dipped = false;
  for (let i = 0; i < 16 && !changed; i += 1) {
    await page.waitForTimeout(500);
    const now = await opacities();
    if (Math.max(...now) < 0.99) dipped = true;
    if (now.indexOf(Math.max(...now)) !== first.indexOf(Math.max(...first))) changed = true;
  }
  expect(changed, 'a different slide takes over within 8s').toBe(true);
  expect(dipped, 'the topmost slide is always fully opaque').toBe(false);

  // Typed tagline: it starts empty/short, gets longer as it types, and the phrase changes over time.
  const tagline = page.getByTestId('login-tagline');
  const seen = new Set();
  for (let i = 0; i < 90; i += 1) {
    const t = ((await tagline.textContent()) || '').trim();
    if (t) seen.add(t);
    if ([...seen].some((s) => s.length >= 20) && seen.size > 6) break;
    await page.waitForTimeout(150);
  }
  expect([...seen].some((s) => s.length >= 20), 'a full phrase gets typed').toBe(true);
  expect(seen.size, 'the text is typed one character at a time').toBeGreaterThan(6);
  await expect(tagline).toHaveAttribute('aria-hidden', 'true');

  // The real sign-in heading and controls are still there and readable.
  await expect(page.getByRole('heading', { name: /Sign in to the Cockpit/ })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'login-hero-1-slideshow-and-typing.png') });
});

test('under reduced motion the tagline is static and the first slide is shown', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByTestId('login-screen')).toBeVisible();
  const tagline = page.getByTestId('login-tagline');
  await expect(tagline).toContainText('Sign in to try a calmer way to build.');
  await expect(page.locator('.login-tagline__caret')).toHaveCount(0);
  const first = await page.locator('.login-backdrop__slide').first().evaluate((e) => +getComputedStyle(e).opacity);
  expect(first).toBe(1);
  await ctx.close();
});
