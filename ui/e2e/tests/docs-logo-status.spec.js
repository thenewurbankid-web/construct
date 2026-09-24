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
  const iconHref = (page) => page.locator('link[rel~="icon"]').first().getAttribute('href');
  const pillX = (page, which = 'blue') => page.locator(`.brand-mark .pill-${which}`).evaluate((el) => el.getBoundingClientRect().x);
  const bothX = async (page) => [await pillX(page, 'white'), await pillX(page, 'blue')];

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

  // The docs default motion (the Logo Lab's Handshake, 6.6 s): both pills move 6 units toward each other until they share a column, hold,
  // part, rest. 6 SVG units at 26 px / 48 units = 3.25 px each; the pills start 12 units (6.5 px) apart and meet at 0.
  test('an agent starts working: the pills meet in one column and part again; when it stops the cycle finishes, no snap', async ({ page }) => {
    await page.goto(siteUrl);
    await page.waitForTimeout(2500); // the server caches its answer for 2 s; start from a settled idle
    const [whiteRest, blueRest] = await bothX(page);
    expect(Math.abs(blueRest - whiteRest - 6.5), 'at rest the pills are 12 units apart').toBeLessThan(0.1);

    const iconRest = await iconHref(page);
    const started = Date.now();
    setAge(0);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-dev-status') === 'active', null, { timeout: 20_000 });
    expect(Date.now() - started, 'the logo starts within the poll interval plus the cache').toBeLessThan(12_000);

    // Working: keep the transcript fresh and sample two cycles (6.6 s each).
    const w = [];
    const bl = [];
    const t0 = Date.now();
    let lastTouch = 0;
    while (Date.now() - t0 < 14_500) {
      if (Date.now() - lastTouch > 4000) { setAge(0); lastTouch = Date.now(); }
      const [wx, bx] = await bothX(page);
      w.push(wx);
      bl.push(bx);
      await page.waitForTimeout(80);
    }
    const travel = (xs) => Math.max(...xs) - Math.min(...xs);
    expect(travel(w), 'the white pill moves 6 units right').toBeGreaterThan(3.0);
    expect(travel(w)).toBeLessThan(3.5);
    expect(travel(bl), 'the blue pill moves 6 units left').toBeGreaterThan(3.0);
    expect(travel(bl)).toBeLessThan(3.5);
    expect(Math.max(...w)).toBeGreaterThan(whiteRest + 2.8);
    expect(Math.min(...bl)).toBeLessThan(blueRest - 2.8);
    const gaps = w.map((x, i) => bl[i] - x);
    expect(Math.min(...gaps), 'at the hold they share one column').toBeLessThan(0.3);
    expect(Math.max(...gaps), 'and part again to the resting gap').toBeGreaterThan(6.3);
    expect(bl.some((x, i) => i > bl.length / 2 && Math.abs(x - blueRest) < 0.2), 'it returns to rest inside the window').toBe(true);

    // The tab icon moves the same pills the same way (drawn from the clock), so work shows in a background tab.
    const frames = new Set();
    for (let i = 0; i < 40; i += 1) { frames.add(await iconHref(page)); await page.waitForTimeout(100); }
    expect(frames.size, 'the tab icon changes frame while the agent works').toBeGreaterThanOrEqual(3);
    for (const href of frames) if (href !== iconRest) expect(href).toMatch(/^data:image\/svg\+xml,/);
    setAge(0);

    // Stop the agent while the pills are mid-move, and watch every ~40 ms.
    for (let i = 0; i < 400; i += 1) {
      const x = await pillX(page, 'blue');
      if (x < blueRest - 1.2 && x > blueRest - 2.4) break;
      await page.waitForTimeout(30);
    }
    setAge(5 * 60_000);
    const stopped = Date.now();
    const after = [];
    let sawEnding = false;
    while (Date.now() - stopped < 30_000) {
      const st = await status(page);
      if (st === 'ending') sawEnding = true;
      const [wx, bx] = await bothX(page);
      after.push({ w: wx, b: bx, s: st });
      if (st === null && Date.now() - stopped > 2000) break;
      await page.waitForTimeout(30);
    }
    expect(sawEnding, 'a quiet status winds the cycle down instead of cutting it').toBe(true);
    let maxStep = 0;
    for (let i = 1; i < after.length; i += 1) maxStep = Math.max(maxStep, Math.abs(after[i].w - after[i - 1].w), Math.abs(after[i].b - after[i - 1].b));
    expect(maxStep, 'the pills never jump (a snap would be over a pixel)').toBeLessThan(0.7);
    const end = after[after.length - 1];
    expect(end.s).toBeNull();
    expect(Math.abs(end.b - blueRest) + Math.abs(end.w - whiteRest), 'both end exactly at rest').toBeLessThan(0.1);
    // The tab icon goes back to the static icon once its own cycle is done, and stays there.
    await expect.poll(() => iconHref(page), { timeout: 14_000 }).toBe(iconRest);
    await page.waitForTimeout(3000);
    expect(await iconHref(page)).toBe(iconRest);
    const [w2, b2] = await bothX(page);
    expect(Math.abs(w2 - whiteRest) + Math.abs(b2 - blueRest)).toBeLessThan(0.1);
    expect(await status(page)).toBeNull();
  });

  test('a motion pasted from the Logo Lab in the config panel replaces the default in this browser; a bad paste is refused', async ({ page }) => {
    await page.goto(`${siteUrl}?logo=config`);
    const panel = page.locator('form.logo-panel');
    await expect(panel).toBeVisible();
    await panel.locator('textarea').fill('this is not json');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.locator('.logo-panel-note')).toContainText('not a Line motion');
    // A cockpit-mark export is not a docs-logo motion either.
    await panel.locator('textarea').fill(JSON.stringify({ mark: 'cockpit', parts: { knob: 'neg' } }));
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.locator('.logo-panel-note')).toContainText('not a Line motion');

    const breathe = { mark: 'line', parts: { white: 'still', blue: 'pos' }, effect: 'pulse', distance: 4, axis: 'x', durationSeconds: 3, restBeforePct: 0, restAfterPct: 0, holdPct: 0, beats: 1, easing: { type: 'ease-in-out' }, staggerPct: 0, direction: 'out-and-back' };
    await panel.locator('textarea').fill(JSON.stringify(breathe));
    await panel.locator('select').selectOption('always');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.locator('.logo-panel-note')).toHaveText('Saved.');
    await expect(page.locator('html')).toHaveAttribute('data-dev-status', 'active');
    const css = await page.locator('style#logo-motion').textContent();
    expect(css).toContain('animation: logo-blue 3s infinite');
    expect(css, 'a pill that stays still gets no animation').not.toContain('logo-white');
    const anim = await page.locator('.brand-mark .pill-blue').evaluate((el) => { const c = getComputedStyle(el); return { name: c.animationName, dur: c.animationDuration }; });
    expect(anim).toEqual({ name: 'logo-blue', dur: '3s' });
    // It sticks for this browser across a reload, and "follow the site" (empty paste) puts the default back.
    await page.goto(siteUrl);
    await expect.poll(() => page.locator('style#logo-motion').textContent()).toContain('logo-blue 3s');
    await page.goto(`${siteUrl}?logo=config`);
    await page.locator('form.logo-panel textarea').fill('');
    await page.locator('form.logo-panel').getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => page.locator('style#logo-motion').textContent()).toContain('logo-white 6.6s');
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
