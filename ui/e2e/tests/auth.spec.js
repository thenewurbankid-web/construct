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

/** #365: POST a JSON body exactly as the Cockpit does (credentialed) and report the status. */
async function postJsonStatus(page, route, body) {
  return page.evaluate(
    ([api, route, body]) => fetch(`${api}${route}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status),
    [API, route, body],
  );
}

/** #341: POST one decision exactly as the Cockpit does (credentialed JSON). The body deliberately carries a
 * forged `by`, which the server must never read. */
async function decideStatus(page, id) {
  return page.evaluate(
    ([api, id]) => fetch(`${api}/api/processes/${id}/decide`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', verdict: 'reject', by: 'forger' }),
    }).then((r) => r.status),
    [API, id],
  );
}

/** Attempt the wizard WebSocket upgrade from the page and report whether it
 * opened. A refused upgrade surfaces to a browser as an error/close, never
 * as an open. */
async function wsOpens(page, wsPath = '/ws/wizard') {
  return page.evaluate(
    ([api, wsPath]) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`${api.replace(/^http/, 'ws')}${wsPath}`);
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
    [API, wsPath],
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
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('user-menu')).toHaveCount(0);

    // ...and the server refuses regardless of what the UI renders. This is
    // the assertion that makes this a security test rather than a layout one.
    expect(await apiStatus(page, '/api/settings')).toBe(401);
    expect(await apiStatus(page, '/api/fs/browse?path=/')).toBe(401);
    // #365: the workspace routes are gated too: choosing / closing a project, and the folder browser, need a session
    // BEFORE the workspace boundary is even consulted (401, not the 403 an outside path gets when signed in).
    expect(await apiStatus(page, '/api/fs/browse?path=..')).toBe(401);
    expect(await postJsonStatus(page, '/api/settings', { projectDir: '/etc' })).toBe(401);
    expect(await postJsonStatus(page, '/api/settings', { projectDir: '../..' })).toBe(401);
    expect(await postJsonStatus(page, '/api/settings', { closeProject: true })).toBe(401);
    expect(await postJsonStatus(page, '/api/import', { mode: 'plan', planPath: '/etc/passwd' })).toBe(401);
    expect(await apiStatus(page, '/api/validate')).toBe(401);
    expect(await apiStatus(page, '/api/logs')).toBe(401);
    // #292: the Processes API and its live socket are gated too.
    expect(await apiStatus(page, '/api/processes')).toBe(401);
    expect(await apiStatus(page, '/api/processes/proc_x')).toBe(401);
    expect(await page.evaluate(([api]) => fetch(`${api}/api/processes/proc_x/cancel`, { method: 'POST', credentials: 'include' }).then((r) => r.status), [API])).toBe(401);
    expect(await wsOpens(page, '/ws/processes')).toBe(false);
    // #341: the approval gate's two endpoints. Review is a GET; decide is a mutating POST. Both are refused.
    expect(await apiStatus(page, '/api/processes/proc_x/review')).toBe(401);
    expect(await decideStatus(page, 'proc_x')).toBe(401);
    // #328: the Flow view's read-only endpoints are gated too.
    expect(await apiStatus(page, '/api/flow/billing')).toBe(401);
    expect(await apiStatus(page, '/api/nav/file?feature=billing&path=src/App.tsx')).toBe(401);
    // #330: cloning a repository, its jobs and connecting a remote are gated too (the POSTs are the dangerous part).
    expect(await apiStatus(page, '/api/clone')).toBe(401);
    expect(await apiStatus(page, '/api/clone/abc')).toBe(401);
    expect(await postJsonStatus(page, '/api/clone', { url: 'https://github.com/octocat/Hello-World' })).toBe(401);
    expect(await postJsonStatus(page, '/api/clone/abc/cancel', {})).toBe(401);
    // #330 slice B: a clone WITH an access token and "Pull latest" are gated too, and nothing is echoed back.
    expect(await postJsonStatus(page, '/api/clone', { url: 'https://github.com/octocat/Hello-World', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', branch: 'main' })).toBe(401);
    expect(await postJsonStatus(page, '/api/clone/pull', { name: 'Hello-World', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' })).toBe(401);
    expect(await apiStatus(page, '/api/git/remote')).toBe(401);
    expect(await postJsonStatus(page, '/api/git/remote', { url: 'https://github.com/octocat/Hello-World' })).toBe(401);
    // #312/#313: Review mode's list, its analysis request and one change are gated too.
    expect(await apiStatus(page, '/api/review/branches')).toBe(401);
    expect(await apiStatus(page, '/api/review/change?base=main&head=main')).toBe(401);
    // #316: the saved-plans list (the expected scope) and a change compared with a plan are gated too.
    expect(await apiStatus(page, '/api/review/plans')).toBe(401);
    expect(await apiStatus(page, '/api/review/change?base=main&head=main&plan=proc_x')).toBe(401);
    expect(await page.evaluate(([api]) => fetch(`${api}/api/review/analyze`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: 'main', heads: ['x'] }) }).then((r) => r.status), [API])).toBe(401);
    expect(await page.evaluate(([api]) => fetch(`${api}/api/review/cancel`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: 'main', head: 'x' }) }).then((r) => r.status), [API])).toBe(401);

    // #289/#332: Plan mode's context, proposals, impact, validation and Run are gated too (Run is a mutating POST).
    expect(await apiStatus(page, '/api/plan/context')).toBe(401);
    for (const route of ['propose', 'impact', 'validate', 'run']) {
      expect(await page.evaluate(([api, r]) => fetch(`${api}/api/plan/${r}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x', seeds: ['feature:x'], plan: {} }) }).then((res) => res.status), [API, route])).toBe(401);
    }
    // #300/#301: the Tests tab's list and source reads, and its two mutating POSTs (clone, generate), are gated too.
    expect(await apiStatus(page, '/api/tests/billing')).toBe(401);
    expect(await apiStatus(page, '/api/tests/billing/source?area=generated&name=a--b.spec.ts')).toBe(401);
    expect(await apiStatus(page, '/api/tests/billing/compare?name=mine.spec.ts')).toBe(401);
    const postStatus = (route, body) => page.evaluate(([api, route, body]) => fetch(`${api}${route}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status), [API, route, body]);
    expect(await postStatus('/api/tests/billing/clone', { source: 'a--b.spec.ts', name: 'x' })).toBe(401);
    expect(await postStatus('/api/tests/billing/generate', {})).toBe(401);
    // #305: running the tests: the read of the latest results and the two mutating POSTs (start a run, cancel it) are gated too.
    expect(await apiStatus(page, '/api/tests/billing/runs')).toBe(401);
    expect(await postStatus('/api/tests/billing/run', {})).toBe(401);
    expect(await postStatus('/api/tests/billing/run', { name: 'a--b.spec.ts', area: 'generated', baseUrl: 'http://localhost:3000' })).toBe(401);
    expect(await postStatus('/api/tests/billing/run/cancel', {})).toBe(401);
    // #302: the step document read and its two mutating POSTs (preview an edit, write it) are gated too.
    expect(await apiStatus(page, '/api/tests/billing/steps?name=mine.spec.ts')).toBe(401);
    expect(await postStatus('/api/tests/billing/steps/preview', { name: 'mine.spec.ts', baseHash: 'x', steps: [] })).toBe(401);
    expect(await postStatus('/api/tests/billing/steps', { name: 'mine.spec.ts', baseHash: 'x', resultSha: 'x', steps: [] })).toBe(401);

    // #431/#434: the Components screen's list, its props reader, its file read and its ONE write (a mutating POST), and the
    // Pages screen's list of all pages, are gated too.
    expect(await apiStatus(page, '/api/components')).toBe(401);
    expect(await apiStatus(page, '/api/components/describe?path=features%2Fbilling%2Fcomponents%2FBillingView.tsx')).toBe(401);
    expect(await apiStatus(page, '/api/components/source?path=features%2Fbilling%2Fcomponents%2FBillingView.tsx')).toBe(401);
    expect(await apiStatus(page, '/api/components/source?path=..%2F..%2Fetc%2Fpasswd')).toBe(401);
    expect(await postJsonStatus(page, '/api/components/save', { path: 'features/billing/components/BillingView.tsx', content: 'x', commit: true, contentHash: 'x' })).toBe(401);
    expect(await apiStatus(page, '/api/pages/all')).toBe(401);
    expect(await apiStatus(page, '/api/features')).toBe(401);
    expect(await apiStatus(page, '/api/features/billing/summary')).toBe(401);

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
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true })).toBeVisible();

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
    // #365: signed in, the workspace boundary is what answers: 403 for a path outside it, 409 NO_PROJECT for a
    // project route once the project is closed. (Validate needs a project, so close it first.)
    expect(await postJsonStatus(page, '/api/settings', { projectDir: '/etc' })).toBe(403);
    expect(await postJsonStatus(page, '/api/settings', { projectDir: '../..' })).toBe(403);
    expect(await apiStatus(page, '/api/fs/browse?path=..')).toBe(403);
    expect(await postJsonStatus(page, '/api/import', { mode: 'plan', planPath: '/etc/passwd' })).toBe(403);
    expect(await postJsonStatus(page, '/api/settings', { closeProject: true })).toBe(200);
    expect(await apiStatus(page, '/api/validate')).toBe(409);
    expect(await postJsonStatus(page, '/api/settings', { projectDir: process.env.E2E_DEFAULT_PROJECT_E2E_OWNER })).toBe(200);
    expect(await apiStatus(page, '/api/validate')).toBe(200);
    expect(await wsOpens(page)).toBe(true);
    expect(await apiStatus(page, '/api/processes')).toBe(200);
    expect(await wsOpens(page, '/ws/processes')).toBe(true);
    // #341: signed in, both approval endpoints pass the gate and reach the store, which has no such process (404, not 401).
    expect(await apiStatus(page, '/api/processes/proc_x/review')).toBe(404);
    expect(await decideStatus(page, 'proc_x')).toBe(404);
    // Signed in, Review is reachable (this server's project may not be a repository: a 400 is fine, a 401 is not).
    expect(await apiStatus(page, '/api/review/branches')).not.toBe(401);
    expect(await apiStatus(page, '/api/review/plans')).not.toBe(401);
    // #351: cancel passes the gate too; an unlisted branch is refused (400/404), never a success and never started work.
    expect(await page.evaluate(([api]) => fetch(`${api}/api/review/cancel`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: 'main', head: 'nope' }) }).then((r) => r.status), [API])).toBeGreaterThanOrEqual(400);

    // Signed in, Plan mode's read endpoint passes the gate.
    expect(await apiStatus(page, '/api/plan/context')).not.toBe(401);

    await page.screenshot({ path: path.join(SHOTS, '278-2-signed-in-cockpit.png'), fullPage: true });

    // The menu shows the login and offers Sign out.
    await account.click();
    await expect(account).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('user-menu-login')).toHaveText(TEST_USER);
    // #368: the same menu carries the preference rows, and says which account this is.
    const menu = page.locator('#sh-user-menu');
    await expect(menu).toContainText('Signed in with GitHub');
    await expect(menu.getByTestId('profile-settings')).toHaveAttribute('href', '/settings');
    await expect(menu.getByTestId('profile-local-model')).toHaveAttribute('href', '/ollama');
    await expect(menu.getByTestId('profile-help')).toHaveAttribute('href', '/help');
    await expect(menu.getByRole('group', { name: 'Theme' })).toBeVisible();
    await expect(menu.getByTestId('sign-out')).toBeVisible();
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
