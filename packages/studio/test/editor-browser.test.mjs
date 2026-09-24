// The editor page in a real Chromium (Playwright, one worker, ports 48600-48699): load a fixture project, split with the keyboard,
// trim by dragging an edge, copy and paste, edit a subtitle inline, lock a layer, undo, save, export, and look at 390 px and dark.
// Skipped with a message when no Chromium is installed (`npx playwright install chromium`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createEditorHandler } from '../src/editor/routes.mjs';
import { writeSampleWorkspace } from '../src/editor/sample.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

async function loadChromium() {
  const require = createRequire(import.meta.url);
  for (const spec of ['playwright', 'playwright-core', path.join(REPO, 'ui', 'e2e', 'node_modules', 'playwright-core')]) {
    try {
      const { chromium } = require(spec);
      if (chromium && fs.existsSync(chromium.executablePath())) return chromium;
    } catch { /* try the next place */ }
  }
  return null;
}
const chromium = await loadChromium();
const opts = { skip: chromium ? false : 'no Chromium for Playwright here (run `npx playwright install chromium`); the real-browser check was skipped' };

async function startServer(workspace) {
  const handler = createEditorHandler({
    autosaveDelayMs: 50,
    execFile: (cmd, args, o, cb) => {
      const child = { stdout: new EventEmitter() };
      setImmediate(() => { child.stdout.emit('data', 'out_time_us=3000000\n'); fs.writeFileSync(path.join(o.cwd, args.at(-1)), 'rendered'); cb(null, '', ''); });
      return child;
    },
  });
  const server = http.createServer((req, res) => { handler(req, res, { workspace, url: new URL(req.url, 'http://localhost') }).then((ok) => { if (!ok) { res.statusCode = 404; res.end(); } }); });
  for (let port = 48600; port < 48700; port++) {
    if (await new Promise((resolve) => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); })) return { base: `http://127.0.0.1:${port}`, server };
  }
  throw new Error('no free port in 48600-48699');
}

test('the editor page in Chromium: split, trim by dragging, copy and paste, inline subtitle edit, lock, undo, save, export', opts, async () => {
  const ws = fs.realpathSync(makeTempDir('studio-editor-browser-'));
  writeSampleWorkspace(ws);
  const { base, server } = await startServer(ws);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|the server responded/.test(m.text())) errors.push(m.text()); });
    const server$ = async (p) => (await fetch(`${base}/api/editor${p}`)).json();
    const clipsOf = async (kind) => (await server$('/project/demo')).project.layers.find((l) => l.kind === kind).clips;
    const items = (kind) => page.locator(`.vis-item.kind-${kind}`);

    // first screen: New quick demo is the default path
    await page.goto(`${base}/editor`);
    await page.getByRole('heading', { name: 'New quick demo' }).waitFor();
    assert.equal(await page.locator('#job-select option').count(), 1);
    await page.getByRole('button', { name: 'Open on the timeline' }).click();
    await page.waitForSelector('body[data-ready="demo"]');
    await page.waitForSelector('.vis-item');
    assert.equal(await page.locator('.vis-item').count(), 5, 'one clip per project clip on four layers');
    for (const kind of ['video', 'voice', 'music', 'subtitle']) assert.ok(await items(kind).count() >= 1, kind);
    assert.equal(await page.locator('.vis-label').count(), 4, 'one row per layer');
    assert.match((await page.locator('.vis-text.vis-minor').allTextContents()).join(' '), /0:0\d/, 'the ruler shows mm:ss times');

    // the playhead: click the ruler
    const axis = await page.locator('.vis-panel.vis-top').boundingBox();
    await page.mouse.click(axis.x + axis.width * 0.5, axis.y + axis.height / 2);
    const t1 = await page.locator('#time').innerText();
    assert.notEqual(t1.split(' / ')[0], '0:00.0', `the playhead moved: ${t1}`);

    // split with the keyboard (S): the video clip is cut at the playhead
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    assert.match(await page.locator('#time').innerText(), /^0:03\.0/);
    await page.keyboard.press('s');
    await page.waitForFunction(() => document.querySelectorAll('.vis-item.kind-video').length === 2);
    let video = await clipsOf('video');
    assert.deepEqual(video.map((c) => [c.start, c.duration, c.in]), [[0, 3000, 0], [3000, 7000, 3000]], 'split at 3 s, the right half starts 3 s into the source');
    assert.equal(await page.locator('#save-state').innerText().then((t) => /Unsaved/.test(t)), true);

    // trim by dragging the right edge of the second subtitle
    const sub = page.locator('.vis-item', { hasText: 'A second line of text' });
    await sub.click();
    await page.waitForSelector('.vis-item.vis-selected .vis-drag-right');
    const handle = await page.locator('.vis-item.vis-selected .vis-drag-right').boundingBox();
    const before = (await clipsOf('subtitle')).find((c) => c.id === 'c5');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 40, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.move(handle.x - 90, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(async ([b]) => (await (await fetch('/api/editor/project/demo')).json()).project.layers[3].clips.find((c) => c.id === 'c5').duration < b, [before.duration]);
    const after = (await clipsOf('subtitle')).find((c) => c.id === 'c5');
    assert.equal(after.start, before.start, 'only the end moved');
    assert.ok(after.duration < before.duration && after.duration >= 40, `trimmed from ${before.duration} to ${after.duration}`);

    // drag the first subtitle a little to the right (a move; snapping may pull it to an edge)
    const first = page.locator('.vis-item', { hasText: 'Hello there' });
    const fb = await first.boundingBox();
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width / 2 + 30, fb.y + fb.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(async () => (await (await fetch('/api/editor/project/demo')).json()).project.layers[3].clips.find((c) => c.id === 'c4').start > 500);

    // copy and paste at the playhead
    await first.click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => document.querySelectorAll('.vis-item.kind-subtitle').length === 3);
    const subs = await clipsOf('subtitle');
    assert.equal(subs.length, 3);
    assert.equal(subs.find((c) => c.start === 8000).text, 'Hello there, this is Studio', 'pasted at 8 s with the same text');
    assert.equal(await items('subtitle').count(), 3, 'the timeline shows it');

    // undo takes the paste back, redo restores it
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('.vis-item.kind-subtitle').length === 2);
    assert.equal((await clipsOf('subtitle')).length, 2);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => document.querySelectorAll('.vis-item.kind-subtitle').length === 3);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('.vis-item.kind-subtitle').length === 2);

    // inline subtitle edit (double-click) shows live over the preview
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.locator('.vis-item', { hasText: 'Hello there' }).dblclick();
    const input = page.locator('input.inline-edit');
    await input.waitFor();
    await input.fill('Edited inline');
    await input.press('Enter');
    await page.waitForFunction(async () => (await (await fetch('/api/editor/project/demo')).json()).project.layers[3].clips.find((c) => c.id === 'c4').text === 'Edited inline');
    await page.locator('.vis-item', { hasText: 'Edited inline' }).waitFor();

    // lock the subtitle layer: edits are refused with a message
    await page.getByRole('button', { name: 'Lock Subtitles' }).click();
    await page.waitForFunction(() => document.querySelector('.vis-item.kind-subtitle.locked'));
    await page.locator('.vis-item.kind-subtitle').first().click();
    await page.keyboard.press('Delete');
    await page.waitForSelector('.toast.error');
    assert.match(await page.locator('.toast').innerText(), /locked/i);
    await page.getByRole('button', { name: 'Lock Subtitles' }).click();
    await page.waitForFunction(() => !document.querySelector('.vis-item.kind-subtitle.locked'));

    // save, then export (soft subtitles by default)
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.getElementById('save-state').textContent === 'Saved');
    const onDisk = JSON.parse(fs.readFileSync(path.join(ws, 'demo.studio.json'), 'utf8'));
    assert.equal(onDisk.layers[0].clips.length, 2, 'the split is in the saved file');
    assert.equal(onDisk.layers[3].clips.find((c) => c.id === 'c4').text, 'Edited inline');
    assert.equal(onDisk.rev, 2);
    await page.locator('#export summary').click();
    await page.getByRole('button', { name: 'Export video' }).click();
    await page.locator('#export-links a').first().waitFor();
    assert.deepEqual(await page.locator('#export-links a').allInnerTexts(), ['demo.export.webm', 'demo.srt', 'demo.vtt']);
    assert.match(await page.locator('#export-status').innerText(), /separate track/);
    assert.match(fs.readFileSync(path.join(ws, 'demo.srt'), 'utf8'), /Edited inline/);

    assert.deepEqual(errors, [], 'no script errors or CSP violations');
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
});

test('the editor page at 390 px and in dark mode: no sideways scroll, controls reachable, tokens switch', opts, async () => {
  const ws = fs.realpathSync(makeTempDir('studio-editor-browser2-'));
  writeSampleWorkspace(ws);
  const { base, server } = await startServer(ws);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const [scheme, width] of [['light', 390], ['dark', 390], ['dark', 1280]]) {
      const page = await (await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme })).newPage();
      await page.goto(`${base}/editor`);
      await page.getByRole('heading', { name: 'New quick demo' }).waitFor();
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.equal(bg, scheme === 'dark' ? 'rgb(16, 18, 22)' : 'rgb(246, 247, 249)');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `home fits ${width}px`);
      await page.goto(`${base}/editor#/p/demo`);
      await page.waitForSelector('body[data-ready="demo"]');
      await page.waitForSelector('.vis-item');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `the editor fits ${width}px without sideways scroll`);
      for (const name of ['Split', 'Undo', 'Play', 'Save']) assert.ok(await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().isVisible(), name);
      const box = await page.locator('#timeline').boundingBox();
      assert.ok(box.width <= width && box.width > 300, `the timeline is ${box.width}px wide`);
      // keyboard focus is visible
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => { const el = document.activeElement; return el && getComputedStyle(el).outlineStyle; });
      assert.notEqual(outline, 'none');
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
});
