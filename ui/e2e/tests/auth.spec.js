import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #278 — GitHub OAuth login: every API route and the WebSocket require a
// session.
//
// The point of this spec is the sentence in the issue: "without login it
// should not work". So it proves both halves against a *real* server
// running with the gate armed (see playwright.auth.config.js):
//
//   1. Logged out, the app is unusable — the login screen replaces the
//      Cockpit, and, far more importantly, the API itself refuses: a
//      direct fetch to /api/* returns 401 and the wizard WebSocket upgrade
//      is rejected. A UI-only gate would pass a screenshot test and still
//      leave the server open, so the API assertions are the real ones here.
//   2. Logged in, the same requests succeed and the account appears in the
//      top bar.
//
// The login is a genuine one: the test clicks the login screen's own
// button, the server mints an ordinary signed session cookie, and the
// browser holds it. There is no test-only header, no stubbed middleware
// and no bypass of `requireSession` anywhere in this file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const TEST_USER = 'e2e-owner';

/** Ask the page to fetch an API route exactly as the Cockpit's own code
 * does (credentialed, from the client origin) and report the status. Run
 * inside the browser rather than through Playwright's request context so
 * the cookie jar under test is the real one. */
async function apiStatus(page, route) {
  return page.evaluate(
    ([api, path]) => fetch(`${api}${path}`, { credentials: 'include' }).then((r) => r.status),
    [API, route],
  );
}

/** Attempt the wizard WebSocket upgrade from the page and report whether it
 * opened. A refused upgrade surfaces to a browser as an error/close, never
 * as an open. */
async function wsOpens(page) {
  return page.evaluate(
    ([api]) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`${api.replace(/^http/, 'ws')}/ws/wizard`);
        const done = (value) => {
          try {
            ws.close();
          } catch {
            /* already closed */
          }
          resolve(value);
        };
        ws.onopen = () => done(true);
        ws.onerror = () => done(false);
        ws.onclose = () => done(false);
        setTimeout(() => done(false), 5000);
      }),
    [API],
  );
}

test.describe('#278 GitHub login gate', () => {
  test('logged out the Cockpit is unusable, and the API refuses — not just the UI', async ({ page }) => {
    await page.goto('/dashboard');

    // The Cockpit frame is gone, replaced by a login screen.
    const login = page.getByTestId('login-screen');
    await expect(login).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in to the Cockpit' })).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Modes' })).toHaveCount(0);
    await expect(page.getByTestId('user-menu')).toHaveCount(0);

    // ...and the server refuses regardless of what the UI renders. This is
    // the assertion that makes this a security test rather than a layout one.
    expect(await apiStatus(page, '/api/settings')).toBe(401);
    expect(await apiStatus(page, '/api/fs/browse?path=/')).toBe(401);
    expect(await apiStatus(page, '/api/validate')).toBe(401);
    expect(await apiStatus(page, '/api/logs')).toBe(401);

    // The one deliberate exception, so a liveness probe still works.
    expect(await apiStatus(page, '/api/health')).toBe(200);

    // The route that actually drives an LLM is refused at the handshake.
    expect(await wsOpens(page)).toBe(false);

    await page.screenshot({ path: path.join(SHOTS, '278-1-login-screen.png'), fullPage: true });
  });

  test('a direct navigation to any screen still lands on the login screen', async ({ page }) => {
    for (const route of ['/', '/settings', '/wizard', '/pages']) {
      await page.goto(route);
      await expect(page.getByTestId('login-screen')).toBeVisible();
    }
  });

  test('signing in makes the same requests succeed and shows the account', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('login-screen')).toBeVisible();

    // A real login: the button posts to /auth/test-login, the server mints
    // an ordinary signed session cookie and the browser keeps it.
    await page.getByTestId('login-test-user').click();

    // The Cockpit frame is back.
    await expect(page.getByTestId('login-screen')).toHaveCount(0);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Modes' })).toBeVisible();

    // The account is in the top bar. The server names the test login's
    // session "<login> (test login)" on purpose, so a Cockpit running with
    // the hatch on says so in the chrome rather than looking like an
    // ordinary signed-in session.
    const account = page.getByTestId('user-menu-trigger');
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute('aria-label', `Signed in as ${TEST_USER} (test login)`);

    // The same calls that were 401 a moment ago now succeed, with the same
    // cookie jar and the same credentialed fetch.
    expect(await apiStatus(page, '/api/settings')).toBe(200);
    expect(await apiStatus(page, '/api/validate')).toBe(200);
    expect(await wsOpens(page)).toBe(true);

    await page.screenshot({ path: path.join(SHOTS, '278-2-signed-in-cockpit.png'), fullPage: true });

    // The menu shows the login and offers Sign out.
    await account.click();
    await expect(account).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('user-menu-login')).toHaveText(TEST_USER);
    await page.screenshot({ path: path.join(SHOTS, '278-3-account-menu.png') });

    // Escape closes it and puts focus back on the trigger — the same
    // keyboard contract the project switcher already honours.
    await page.keyboard.press('Escape');
    await expect(account).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('sign-out')).toHaveCount(0);
    await expect(account).toBeFocused();
  });

  test('the session survives a reload, and signing out closes the gate again', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByTestId('login-test-user').click();
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible();

    // The cookie is httpOnly and persistent — a reload does not sign you out.
    await page.reload();
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible();
    expect(await apiStatus(page, '/api/settings')).toBe(200);

    // The session cookie is not readable by script (httpOnly), so an XSS
    // cannot exfiltrate it.
    expect(await page.evaluate(() => document.cookie)).not.toContain('construct_session');

    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();

    // Back to the login screen, and the API is closed again.
    await expect(page.getByTestId('login-screen')).toBeVisible();
    expect(await apiStatus(page, '/api/settings')).toBe(401);
    expect(await wsOpens(page)).toBe(false);

    await page.screenshot({ path: path.join(SHOTS, '278-4-after-sign-out.png'), fullPage: true });
  });

  test('the login screen names the test login rather than hiding it', async ({ page }) => {
    await page.goto('/');
    // The hatch is visible in the product, not a secret endpoint the UI
    // pretends not to have — it says what it is and when it is refused.
    await expect(page.getByTestId('login-test-user')).toHaveText(`Sign in as ${TEST_USER} (test login)`);
    await expect(page.getByText(/refused under NODE_ENV=production and off loopback/)).toBeVisible();
  });
});
