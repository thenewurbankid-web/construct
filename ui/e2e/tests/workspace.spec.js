import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #365 — the hosted Cockpit starts with NO project and cannot leave ONE workspace.
//
// Runs under playwright.workspace.config.js: a real server whose workspace is a narrow directory of its own
// (E2E_WORKSPACE_ROOT), with no preloaded project, next to an `outside` sibling that really exists and holds a
// secret. Nothing is stubbed. The boundary attacks go straight at the HTTP API (a real attacker would not use
// the picker), and the UI cases prove what a first-time visitor sees and can do.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const BIN = path.resolve(__dirname, '../../../packages/cli/construct.mjs');
const WS = process.env.E2E_WORKSPACE_ROOT;
const SANDBOX = process.env.E2E_WORKSPACE_SANDBOX;
const OUTSIDE = path.join(SANDBOX, 'outside');

const post = (request, url, data) => request.post(`${API}${url}`, { data });
const browse = (request, p) => request.get(`${API}/api/fs/browse`, { params: p === undefined ? {} : { path: p } });

test.describe.serial('#365 workspace boundary', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(OUTSIDE, { recursive: true });
    fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'top secret');
    fs.mkdirSync(path.join(OUTSIDE, 'a-project'), { recursive: true });
    fs.writeFileSync(path.join(OUTSIDE, 'a-project', 'architecture.yml'), 'version: 1\n');
    // Inside the workspace: a real, initialised project, a plain folder, and two escape attempts.
    fs.mkdirSync(path.join(WS, 'shop'), { recursive: true });
    execFileSync(process.execPath, [BIN, 'init', path.join(WS, 'shop')], { stdio: 'ignore' });
    fs.mkdirSync(path.join(WS, 'notes'), { recursive: true });
    fs.symlinkSync(OUTSIDE, path.join(WS, 'link-to-outside'));
    fs.symlinkSync(path.join(OUTSIDE, 'a-project'), path.join(WS, 'link-to-project'));
  });

  test.afterAll(async ({ request }) => {
    await post(request, '/api/settings', { closeProject: true });
    for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
    fs.rmSync(OUTSIDE, { recursive: true, force: true });
  });

  test('a fresh server has no project open: every project screen says "Open a project"', async ({ page, request }) => {
    const settings = await (await request.get(`${API}/api/settings`)).json();
    expect(settings.projectDir).toBeNull();
    expect(settings.noProject).toBe(true);
    expect(settings.workspaceRoot).toBe(WS);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible();
    // #429: with no project the whole UI is blocked behind the gate: no project switcher, no rail.
    await expect(page.getByTestId('project-switcher')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true })).toHaveCount(0);
    // One prompt on other screens too, not a per-screen error.
    for (const route of ['/wizard', '/pages', '/workflows', '/plan', '/review', '/tests']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: 'Open a project' }), route).toBeVisible();
    }
    await page.goto('/');
    // #568: the picker is a flat "Your projects" list of my workspace: no breadcrumb, no way up, and a hint.
    const picker = page.getByRole('region', { name: 'Your projects' });
    await expect(picker.getByTestId('dir-picker-crumbs')).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Up one level' })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Select shop' })).toBeVisible();
    await expect(picker.locator('li', { hasText: 'shop' }).getByText('Construct project', { exact: true })).toBeVisible();
    await expect(page.getByTestId('no-project')).toContainText('git clone');
    await expect(page.getByTestId('no-project')).toContainText(WS);
    await page.screenshot({ path: path.join(SHOTS, '365-1-open-a-project.png'), fullPage: true });
  });

  test('the picker never lists a symlink that leaves the workspace, nor anything above it', async ({ page }) => {
    await page.goto('/');
    const picker = page.getByRole('region', { name: 'Your projects' });
    await expect(picker.getByRole('button', { name: 'Select notes' })).toBeVisible();
    await expect(picker.locator('li', { hasText: 'notes' })).toContainText('not a Construct project yet');
    await expect(picker.getByText('link-to-outside')).toHaveCount(0);
    await expect(picker.getByText('link-to-project')).toHaveCount(0);
    await expect(picker.getByText('outside')).toHaveCount(0);
    await expect(picker.getByText('secret.txt')).toHaveCount(0);
  });

  test('ATTACK: settings refuses `..`, absolute paths, symlinks out, a sibling prefix and NUL; nothing opens', async ({ request }) => {
    const attempts = [
      '..', '../outside', `${WS}/../outside`, `${WS}/notes/../../outside/a-project`, OUTSIDE, path.join(OUTSIDE, 'a-project'),
      '/', '/etc', '/root', 'link-to-outside', 'link-to-project', path.join(WS, 'link-to-outside'), `${WS}-evil`, 'notes\0/../../outside',
    ];
    for (const projectDir of attempts) {
      const res = await post(request, '/api/settings', { projectDir });
      expect([400, 403, 404], `${JSON.stringify(projectDir)} -> ${res.status()}`).toContain(res.status());
      expect((await res.json()).code).toBeTruthy();
    }
    const settings = await (await request.get(`${API}/api/settings`)).json();
    expect(settings.projectDir).toBeNull();
    // A client cannot widen the picker either.
    const widen = await post(request, '/api/settings', { browseRoots: ['/'] });
    expect(widen.status()).toBe(400);
  });

  test('ATTACK: the folder browser refuses the same, and never reveals what is outside', async ({ request }) => {
    for (const p of ['..', '../outside', `${WS}/..`, OUTSIDE, path.join(OUTSIDE, 'a-project'), '/', '/etc', 'link-to-outside', path.join(WS, 'link-to-outside', 'a-project')]) {
      const res = await browse(request, p);
      expect(res.status(), p).toBe(403);
      const text = await res.text();
      expect(text).not.toContain('secret.txt');
      expect(text).not.toContain('a-project');
    }
    const top = await (await browse(request)).json();
    expect(top.path).toBe(WS);
    expect(top.parent).toBeNull();
    expect(top.entries.map((e) => e.name).sort()).toEqual(['notes', 'shop']);
    // #568: one level - a real folder inside the workspace is refused too, with the same 403 as an outside path.
    for (const p of ['shop', path.join(WS, 'shop'), path.join(WS, 'notes')]) {
      expect((await browse(request, p)).status(), p).toBe(403);
    }
  });

  test('ATTACK: with a project open, import cannot read files outside the workspace', async ({ request }) => {
    expect((await post(request, '/api/settings', { projectDir: 'shop' })).ok()).toBeTruthy();
    for (const body of [
      { mode: 'unit', name: 'x', feature: 'core', layers: ['domain'], from: path.join(OUTSIDE, 'secret.txt') },
      { mode: 'unit', name: 'x', feature: 'core', layers: ['domain'], from: '../../outside/secret.txt' },
      { mode: 'unit', name: 'x', feature: 'core', layers: ['domain'], from: '/etc/passwd' },
      { mode: 'unit', name: 'x', feature: 'core', layers: ['domain'], from: path.join(WS, 'link-to-outside', 'secret.txt') },
      { mode: 'plan', planPath: '/etc/passwd' },
      { mode: 'plan', planPath: path.join(WS, 'link-to-outside', 'secret.txt') },
    ]) {
      const res = await post(request, '/api/import', body);
      expect(res.status(), JSON.stringify(body)).toBe(403);
    }
    // The pages/source routes take feature+file names only, and refuse a traversal through them.
    const trav = await request.get(`${API}/api/pages/source`, { params: { feature: '../../../outside', file: '../secret.txt' } });
    expect(trav.status()).toBeGreaterThanOrEqual(400);
    expect(await trav.text()).not.toContain('top secret');
    await post(request, '/api/settings', { closeProject: true });
    // And once closed, project routes answer one consistent 409, not a crash or a fallback to the server's cwd.
    for (const url of ['/api/units', '/api/pages/features', '/api/validate', '/api/processes']) {
      const res = await request.get(`${API}${url}`);
      expect(res.status(), url).toBe(409);
      expect((await res.json()).code).toBe('NO_PROJECT');
    }
  });

  test('opening a project inside the workspace works from the picker; it can be closed and reopened', async ({ page }) => {
    await page.goto('/');
    const picker = page.getByRole('region', { name: 'Your projects' });
    await picker.getByRole('button', { name: 'Select shop' }).click();
    await expect(page.getByRole('heading', { name: 'Features', level: 1 })).toBeVisible();
    await expect(page.getByTestId('project-switcher')).toContainText('shop');
    await page.screenshot({ path: path.join(SHOTS, '365-2-project-open.png'), fullPage: true });

    // Close it from the header: back to the prompt, with the closed project offered (never auto-opened).
    await page.getByTestId('project-switcher').click();
    await page.getByTestId('close-project').click();
    await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible();
    await expect(page.getByTestId('project-switcher')).toHaveCount(0);
    const reopen = page.getByTestId('reopen-project');
    await expect(reopen).toHaveText('Reopen shop');
    await page.screenshot({ path: path.join(SHOTS, '365-3-closed-reopen-offered.png'), fullPage: true });
    await reopen.click();
    await expect(page.getByRole('heading', { name: 'Features', level: 1 })).toBeVisible();
    await expect(page.getByTestId('project-switcher')).toContainText('shop');
  });

  test('a project that is replaced by a symlink out of the workspace stops being served', async ({ request }) => {
    fs.mkdirSync(path.join(WS, 'swap'));
    expect((await post(request, '/api/settings', { projectDir: 'swap' })).ok()).toBeTruthy();
    fs.rmSync(path.join(WS, 'swap'), { recursive: true });
    fs.symlinkSync(path.join(OUTSIDE, 'a-project'), path.join(WS, 'swap'));
    const res = await request.get(`${API}/api/units`);
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('NO_PROJECT');
    const settings = await (await request.get(`${API}/api/settings`)).json();
    expect(settings.projectDir).toBeNull();
    fs.unlinkSync(path.join(WS, 'swap'));
  });
});
