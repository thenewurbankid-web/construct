import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #614: the docs site's logo is a status light. End to end and for real: the built docs site (whose logo.json says "follow this
// endpoint"), the real Cockpit server answering GET /api/dev-status from real file times, and a real browser. Fake agent transcripts
// live in a throwaway HOME, so an agent "starts" and "stops" by touching one file, deterministically (no waiting out the real
// 60 s window). What it proves: the logo is still while nothing works, moves (blue pill 12 units under the white one and back) when
// an agent starts, FINISHES its current cycle when the agent stops instead of snapping, stays still after, and does not stay
// animated when the endpoint goes away.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

test.describe.serial('Docs logo follows the framework-development status (#614)', () => {
  test.slow();
  let tmp;
  let transcript;
  let apiServer;
  let siteServer;
  let apiUrl;
  let siteUrl;
  const setAge = (ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(transcript, t, t); };

  test.beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og614-logo-'));
    const out = path.join(tmp, 'site');
    execFileSync('node', ['site/build.mjs', '--out', out, '--no-search', '--no-api'], { cwd: REPO_ROOT, stdio: 'ignore' });

    const home = path.join(tmp, 'home');
    const fakeRepo = path.join(tmp, 'fake-repo');
    const slug = path.resolve(fakeRepo).replace(/[\\/.]/g, '-');
    transcript = path.join(home, '.claude', 'projects', slug, 'sess.jsonl');
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.mkdirSync(path.join(home, 'workspace'), { recursive: true });
    fs.writeFileSync(transcript, 'x');
    setAge(5 * 60_000); // nothing is working

    const apiPort = await freePort();
    apiServer = spawn('node', ['src/index.mjs'], {
      cwd: path.join(REPO_ROOT, 'ui', 'server'),
      env: { ...process.env, HOME: home, PORT: String(apiPort), UI_CLIENT_ORIGIN: 'http://localhost:1', CONSTRUCT_STATE_DIR: path.join(tmp, 'state'), CONSTRUCT_WORKSPACE_ROOT: path.join(home, 'workspace'), CONSTRUCT_DEV_ACTIVITY_REPO: fakeRepo },
      stdio: 'ignore',
    });
    apiUrl = `http://127.0.0.1:${apiPort}/api/dev-status`;
    for (let i = 0; i < 80; i += 1) {
      try { if ((await fetch(apiUrl)).ok) break; } catch { /* still starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }

    const logoJson = JSON.stringify({ mode: 'status', api: apiUrl });
    siteServer = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/logo.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end(logoJson);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(out, p);
      if (!f.startsWith(out) || !fs.existsSync(f)) return void res.writeHead(404).end();
      return void res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
    });
    await new Promise((resolve) => siteServer.listen(0, '127.0.0.1', resolve));
    siteUrl = `http://127.0.0.1:${siteServer.address().port}/`;
  });

  test.afterAll(async () => {
    apiServer?.kill();
    await new Promise((resolve) => (siteServer ? siteServer.close(resolve) : resolve()));
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  const status = (page) => page.evaluate(() => document.documentElement.getAttribute('data-dev-status'));
  const pillX = (page) => page.locator('.brand-mark .pill-blue').evaluate((el) => el.getBoundingClientRect().x);

  test('the endpoint answers from real file times, booleans only', async () => {
    const idle = await (await fetch(apiUrl)).json();
    expect(idle).toEqual({ ok: true, available: true, active: false });
  });

  test('nothing working: the logo is still, and it reads the endpoint the site setting names', async ({ page }) => {
    let polls = 0;
    page.on('request', (r) => { if (r.url().includes('/api/dev-status')) polls += 1; });
    await page.goto(siteUrl);
    await page.waitForTimeout(2500);
    expect(await status(page)).toBeNull();
    expect(polls, 'the endpoint is being read').toBeGreaterThan(0);
    const x = await pillX(page);
    await page.waitForTimeout(1500);
    expect(await pillX(page)).toBe(x);
  });

  test('an agent starts working: the blue pill slides 12 units under the white one and back; when it stops the cycle finishes, no snap', async ({ page }) => {
    await page.goto(siteUrl);
    await page.waitForTimeout(2500); // the server caches its answer for 2 s; start from a settled idle
    const rest = await pillX(page);

    const started = Date.now();
    setAge(0);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-dev-status') === 'active', null, { timeout: 20_000 });
    expect(Date.now() - started, 'the logo starts within the poll interval plus the cache').toBeLessThan(12_000);

    // Working: keep the transcript fresh and sample about two cycles (9 s each).
    const xs = [];
    const t0 = Date.now();
    let lastTouch = 0;
    while (Date.now() - t0 < 19_000) {
      if (Date.now() - lastTouch > 4000) { setAge(0); lastTouch = Date.now(); }
      xs.push(await pillX(page));
      await page.waitForTimeout(100);
    }
    const travel = Math.max(...xs) - Math.min(...xs);
    // 12 SVG units at 26 px / 48 units = 6.5 px, to the left of rest (under the white pill), and back to rest.
    expect(travel).toBeGreaterThan(6.2);
    expect(travel).toBeLessThan(6.8);
    expect(Math.max(...xs)).toBeLessThan(rest + 0.1);
    expect(xs.some((x, i) => i > xs.length / 2 && Math.abs(x - rest) < 0.2), 'it slides back to rest').toBe(true);

    // Stop the agent while the pill is mid-slide, and watch every 30 ms.
    for (let i = 0; i < 400; i += 1) {
      const x = await pillX(page);
      if (x < rest - 2.5 && x > rest - 4.5) break;
      await page.waitForTimeout(40);
    }
    setAge(5 * 60_000);
    const stopped = Date.now();
    const after = [];
    let sawEnding = false;
    while (Date.now() - stopped < 25_000) {
      const s = await status(page);
      if (s === 'ending') sawEnding = true;
      after.push({ x: await pillX(page), s, t: Date.now() - stopped });
      if (s === null && Date.now() - stopped > 2000) break;
      await page.waitForTimeout(30);
    }
    expect(sawEnding, 'a quiet status winds the cycle down instead of cutting it').toBe(true);
    let maxStep = 0;
    for (let i = 1; i < after.length; i += 1) maxStep = Math.max(maxStep, Math.abs(after[i].x - after[i - 1].x));
    expect(maxStep, 'the pill never jumps (a snap would be several pixels)').toBeLessThan(1);
    expect(after[after.length - 1].s).toBeNull();
    expect(Math.abs(after[after.length - 1].x - rest), 'it ends exactly at rest').toBeLessThan(0.05);
    // And it stays still afterwards.
    await page.waitForTimeout(3000);
    expect(Math.abs((await pillX(page)) - rest)).toBeLessThan(0.05);
    expect(await status(page)).toBeNull();
  });

  test('the endpoint goes away while the agent is working: the logo does not stay animated', async ({ page }) => {
    await page.goto(siteUrl);
    await page.waitForTimeout(2500);
    setAge(0);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-dev-status') === 'active', null, { timeout: 20_000 });
    apiServer.kill();
    // No answer counts as not working; the current cycle finishes (at most 9 s), then it is still.
    await page.waitForFunction(() => document.documentElement.getAttribute('data-dev-status') === null, null, { timeout: 40_000 });
    const rest = await pillX(page);
    await page.waitForTimeout(1500);
    expect(await pillX(page)).toBe(rest);
  });
});
