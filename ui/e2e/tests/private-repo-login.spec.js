import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAxe, isBlocking, format } from './support/axe.js';

// #638 -- "Connect GitHub for private repositories": connect with GitHub, see the repository picker, clone with the
// login (no pasted token), disconnect, and confirm the pasted-token fallback still works.
//
// Runs under playwright.github-repo.config.js: a real Cockpit server with login REQUIRED (the e2e test login mints a real
// signed session), a MOCK GitHub (support/mock-github.mjs: a local http server for github.com/login/oauth and
// api.github.com, never the real one) and a local bare repository as the clone source (test-harness-only file:// seam).
// The mock is also a witness: it reports every token it issued, and this spec searches for them everywhere the browser
// or the disk could hold one.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.E2E_API_BASE;
const MOCK = process.env.E2E_MOCK_GITHUB_ORIGIN;
const SANDBOX = process.env.E2E_WORKSPACE_SANDBOX;
const FIXTURES = process.env.E2E_CLONE_FIXTURES;
const WS = path.join(process.env.E2E_WORKSPACE_ROOT, 'e2e-owner'); // per-user workspace (#567)
const BIN = path.resolve(__dirname, '../../../packages/cli/construct.mjs');
const TYPED_TOKEN = 'ghp_typedFallbackTokenForTheFixture0123456789';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fixtureUrl = (name) => `file://${path.join(FIXTURES, name)}`;

/** A bare repository in the fixtures directory that opens as a Construct project. */
function makeFixture(name) {
  const seed = path.join(SANDBOX, `seed-${name}`);
  fs.mkdirSync(seed, { recursive: true });
  execFileSync(process.execPath, [BIN, 'init', seed], { stdio: 'ignore' });
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'first commit');
  git(SANDBOX, 'clone', '-q', '--bare', seed, path.join(FIXTURES, `${name}.git`));
  fs.rmSync(seed, { recursive: true, force: true });
}

/** Every file under `root` (following no links) that contains `needle`. */
function grepTree(root, needle) {
  const hits = [];
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && fs.readFileSync(p).includes(needle)) hits.push(p);
    }
  }
  return hits;
}

const mockSeen = async () => (await fetch(`${MOCK}/__seen`)).json();

/** Sign in with the e2e test login (a real signed session cookie) and land on the Open-a-project screen (no project open). */
async function signIn(page) {
  await page.goto('/');
  const login = page.getByTestId('login-screen');
  await expect(login.or(page.getByRole('banner'))).toBeVisible();
  if (await login.isVisible()) await page.getByTestId('login-test-user').click();
  await expect(page.getByRole('banner')).toBeVisible();
  await page.request.post(`${API}/api/settings`, { data: { closeProject: true } });
  await page.goto('/');
  await expect(page.getByTestId('clone')).toBeVisible();
}

test.describe.serial('#638 clone a private repository with a GitHub login', () => {
  /** Everything the browser was ever sent by the Cockpit server, kept to search for a token at the end. */
  const received = [];

  test.beforeEach(({ page }) => {
    page.on('response', async (res) => {
      if (res.url().startsWith(API)) received.push(`${res.request().method()} ${res.url()} ${res.status()} ${JSON.stringify(res.headers())} ${await res.text().catch(() => '')}`);
    });
  });

  test.beforeAll(() => {
    makeFixture('fixture-app');
    makeFixture('secret-app');
  });

  test.afterAll(() => {
    for (const name of fs.existsSync(WS) ? fs.readdirSync(WS) : []) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
    fs.rmSync(FIXTURES, { recursive: true, force: true });
    fs.rmSync(path.join(SANDBOX, 'state'), { recursive: true, force: true });
  });

  test('connect: the button, the round trip through the mock GitHub, and the account shown', async ({ page }) => {
    await signIn(page);
    const panel = page.getByTestId('clone');
    // Enabled but not connected: one button, and the pasted-token field is still right there.
    await expect(panel.getByTestId('github-connect')).toHaveText('Connect GitHub for private repositories');
    await expect(panel.getByTestId('clone-token')).toBeVisible();
    await expect(panel.getByTestId('github-connected-panel')).toHaveCount(0);

    await panel.getByTestId('github-connect').click();
    // Cockpit -> mock GitHub authorize -> Cockpit /auth/repo/callback -> back on the Cockpit, now connected.
    await expect(page.getByTestId('github-connected-panel')).toBeVisible();
    const connected = page.getByTestId('github-connected-panel');
    await expect(connected.getByTestId('clone-auth-login')).toBeChecked();
    await expect(connected).toContainText('Use my GitHub login (octo-mock)');
    // The token field is not in the way while the login is the default; the fallback is one click away.
    await expect(connected.getByTestId('clone-token')).toHaveCount(0);
    await expect(connected.getByTestId('clone-auth-token')).toBeVisible();
    // The URL is where the browser came back to: the Cockpit, with nothing of the connection in it.
    expect(page.url()).not.toMatch(/code=|state=|token/);
    const seen = await mockSeen();
    expect(seen.seen.some((r) => r.path === '/login/oauth/access_token')).toBe(true);
    expect(seen.seen.some((r) => r.path === '/user' && r.bearer)).toBe(true);
  });

  test('the repository picker is filled from GitHub and picking one fills the address', async ({ page }) => {
    await signIn(page);
    const picker = page.getByTestId('github-repo-picker');
    await expect(picker).toBeVisible();
    const select = picker.getByTestId('github-repo-select');
    await expect(select.locator('option')).toHaveText(['Choose a repository…', 'octo-mock/fixture-app (private)', 'octo-mock/private-notes (private)', 'octo-org/public-site']);
    await picker.getByTestId('github-repo-filter').fill('notes');
    await expect(select.locator('option')).toHaveText(['Choose a repository…', 'octo-mock/private-notes (private)']);
    await picker.getByTestId('github-repo-filter').fill('');
    await expect(select.locator('option')).toHaveCount(4);
    await select.selectOption('octo-mock/fixture-app');
    await expect(page.getByTestId('clone-url')).toHaveValue('https://github.com/octo-mock/fixture-app');
    await expect(page.getByTestId('clone-preview-url')).toHaveText('https://github.com/octo-mock/fixture-app.git');
    await expect(select).toHaveValue('octo-mock/fixture-app');
  });

  test('Settings shows the connection and the account', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');
    const row = page.getByTestId('github-connection');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('github-summary')).toContainText('Connected as octo-mock');
    await expect(row.getByTestId('settings-github-disconnect')).toBeVisible();
  });

  test('accessibility: the connected form and the Settings row have no serious axe violations, both themes, wide and narrow', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 800 }]) {
        await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
        await page.setViewportSize(vp);
        await signIn(page);
        await expect(page.getByTestId('github-repo-select').locator('option')).toHaveCount(4);
        const form = (await runAxe(page)).filter(isBlocking);
        expect(form, `connected form ${theme} ${vp.width}\n${format(form)}`).toEqual([]);
        await page.goto('/settings');
        await expect(page.getByTestId('github-connection')).toBeVisible();
        const row = (await runAxe(page)).filter(isBlocking);
        expect(row, `settings row ${theme} ${vp.width}\n${format(row)}`).toEqual([]);
      }
    }
  });

  test('clone with the login: no token in the request, the job says so, origin stays plain, and no token anywhere', async ({ page }) => {
    await signIn(page);
    const panel = page.getByTestId('clone');
    // The repository the picker offered stands in for a real github.com one; the local fixture is the clone source.
    await panel.getByTestId('clone-url').fill(fixtureUrl('fixture-app.git'));
    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url() === `${API}/api/clone`);
    await panel.getByTestId('clone-start').click();
    const body = JSON.parse((await post).postData() ?? '{}');
    expect(body).toEqual({ url: fixtureUrl('fixture-app.git'), useLogin: true });
    await expect(page.getByTestId('project-switcher')).toContainText('fixture-app', { timeout: 30_000 });

    expect(git(path.join(WS, 'fixture-app'), 'remote', 'get-url', 'origin')).toBe(fixtureUrl('fixture-app.git'));
    expect(fs.existsSync(path.join(WS, 'fixture-app', 'architecture.yml'))).toBe(true);
    const jobs = (await (await page.request.get(`${API}/api/clone`)).json()).jobs;
    expect(jobs.find((j) => j.name === 'fixture-app')).toMatchObject({ state: 'done', private: true, via: 'login' });

    // The witness: every token the mock issued, searched for in what the browser received, in the browser's storage and
    // cookies, and in every file under the sandbox (workspace, clone, fixtures, server state).
    const issued = (await mockSeen()).issued;
    expect(issued.length).toBeGreaterThanOrEqual(1);
    const everything = received.join('\n');
    const inBrowser = await page.evaluate(() => JSON.stringify([document.cookie, { ...localStorage }, { ...sessionStorage }, location.href]));
    const cookies = JSON.stringify(await page.context().cookies());
    for (const t of issued) {
      expect(everything.includes(t), 'a response the Cockpit sent').toBe(false);
      expect(inBrowser.includes(t), 'browser storage').toBe(false);
      expect(cookies.includes(t), 'a cookie').toBe(false);
      expect(grepTree(SANDBOX, t), 'a file on disk').toEqual([]);
    }
    expect(everything).not.toContain('mock-client-secret');
  });

  test('Disconnect takes the connection away at once; the form goes back to Connect, the token field is there again', async ({ page }) => {
    await signIn(page);
    const issued = (await mockSeen()).issued.filter((t) => t.startsWith('ghu_'));
    await page.getByTestId('github-disconnect').click();
    await expect(page.getByTestId('github-connect')).toBeVisible();
    await expect(page.getByTestId('github-connected-panel')).toHaveCount(0);
    await expect(page.getByTestId('clone-token')).toBeVisible();
    const connectPanel = (await runAxe(page)).filter(isBlocking);
    expect(connectPanel, `connect panel\n${format(connectPanel)}`).toEqual([]);
    // Server side: no connection, and the token was revoked at the (mock) provider.
    expect((await (await page.request.get(`${API}/api/github/status`)).json())).toEqual({ ok: true, enabled: true, connected: false });
    expect((await page.request.get(`${API}/api/github/repos`)).status()).toBe(409);
    const login = await page.request.post(`${API}/api/clone`, { data: { url: fixtureUrl('secret-app.git'), useLogin: true } });
    expect(login.status()).toBe(409);
    expect((await login.json()).code).toBe('NOT_CONNECTED');
    expect((await mockSeen()).seen.some((r) => r.method === 'DELETE' && r.path.startsWith('/applications/'))).toBe(true);
    expect(issued.length).toBeGreaterThan(0);
    // Settings agrees.
    await page.goto('/settings');
    await expect(page.getByTestId('github-summary')).toContainText('Not connected');
    await expect(page.getByTestId('settings-github-connect')).toBeVisible();
  });

  test('the pasted-token fallback still works: the token goes in the body, never with useLogin', async ({ page }) => {
    await signIn(page);
    const panel = page.getByTestId('clone');
    await panel.getByTestId('clone-url').fill(fixtureUrl('secret-app.git'));
    await panel.getByTestId('clone-token').fill(TYPED_TOKEN);
    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url() === `${API}/api/clone`);
    await panel.getByTestId('clone-start').click();
    const body = JSON.parse((await post).postData() ?? '{}');
    expect(body).toEqual({ url: fixtureUrl('secret-app.git'), token: TYPED_TOKEN });
    await expect(page.getByTestId('project-switcher')).toContainText('secret-app', { timeout: 30_000 });
    const jobs = (await (await page.request.get(`${API}/api/clone`)).json()).jobs;
    const job = jobs.find((j) => j.name === 'secret-app');
    expect(job).toMatchObject({ state: 'done', private: true });
    expect(job.via).toBeUndefined();
    expect(JSON.stringify(jobs)).not.toContain(TYPED_TOKEN);
    expect(git(path.join(WS, 'secret-app'), 'remote', 'get-url', 'origin')).toBe(fixtureUrl('secret-app.git'));
    expect(grepTree(SANDBOX, TYPED_TOKEN)).toEqual([]);
  });

  test('connecting again after a disconnect works (a fresh state each time), and a callback replay is refused', async ({ page, context }) => {
    await signIn(page);
    // Follow the authorize hop by hand so the callback URL can be replayed.
    const start = await context.request.get(`${API}/auth/repo/start`, { maxRedirects: 0 });
    expect(start.status()).toBe(302);
    const authorize = await fetch(start.headers().location, { redirect: 'manual' });
    const callback = authorize.headers.get('location');
    expect(callback).toContain('/auth/repo/callback?code=');
    const first = await context.request.get(callback, { maxRedirects: 0 });
    expect(first.status()).toBe(302);
    expect((await (await context.request.get(`${API}/api/github/status`)).json()).connected).toBe(true);
    const replay = await context.request.get(callback, { maxRedirects: 0 });
    expect(replay.status()).toBe(400);
    // The connection made by the first callback is still the one that stands.
    expect((await (await context.request.get(`${API}/api/github/status`)).json()).connected).toBe(true);
    // A foreign Origin cannot disconnect it.
    expect((await context.request.post(`${API}/api/github/disconnect`, { data: {}, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    expect((await (await context.request.get(`${API}/api/github/status`)).json()).connected).toBe(true);
    await page.goto('/');
    await expect(page.getByTestId('github-connected-panel')).toBeVisible();
    // Signing out wipes it.
    await context.request.post(`${API}/auth/logout`, { data: {} });
    await page.goto('/');
    await page.getByTestId('login-test-user').click();
    await expect(page.getByTestId('github-connect')).toBeVisible();
  });

  test('a clone the connection cannot see says which app installation or approval is missing (UI with a stubbed answer)', async ({ page }) => {
    await signIn(page);
    await page.route(`${API}/api/clone`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({
        status: 202, contentType: 'application/json',
        body: JSON.stringify({ ok: true, job: { id: 'stub', kind: 'clone', title: 'Clone octo-org/hidden', url: 'https://github.com/octo-org/hidden.git', name: 'hidden', state: 'failed', progress: 'Starting', bytes: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: 'Your GitHub connection cannot see this repository. Either the address is misspelled, or the Cockpit’s GitHub app is not installed on it: install the app on this repository, and for an organisation’s repository ask an organisation owner to install or approve it.', code: 'NOT_VISIBLE_TO_CONNECTION', private: true, via: 'login', log: [] } }),
      });
    });
    const panel = page.getByTestId('clone');
    await panel.getByTestId('github-connect').click();
    await expect(page.getByTestId('github-connected-panel')).toBeVisible();
    await panel.getByTestId('clone-url').fill('octo-org/hidden');
    await panel.getByTestId('clone-start').click();
    await expect(panel.getByTestId('clone-progress')).toContainText('organisation owner');
    await expect(panel.getByTestId('clone-progress')).toContainText('GitHub app is not installed');
  });
});
