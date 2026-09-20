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
const BIN = path.resolve(__dirname, '../../../bin/construct.mjs');
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

const workspaceEntries = () => fs.readdirSync(WS).sort();

test.describe.serial('#330 clone a repository', () => {
  test.beforeAll(() => {
    makeFixture('demo-app');
    makeFixture('bulky-app', { bigMb: 60 });
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
    // Advice as you type, without blocking: the server decides.
    await panel.getByTestId('clone-url').fill('git@github.com:octocat/Hello-World.git');
    await expect(panel).toContainText('Use an https:// address');
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
    expect(job.error).toMatch(/public repository/);
  });
});
