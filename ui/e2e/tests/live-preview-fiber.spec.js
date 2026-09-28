import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

const API = process.env.E2E_API_BASE || 'http://localhost:4000';

// #443 (slice 5) — click-to-source by reading React's own dev-time internals, end to end: a REAL Chromium,
// a REAL dev server, the REAL injecting proxy (packages/engine/previewProxy.mjs) and the REAL bridge script
// (packages/engine/previewFiber.mjs) it injects, a REAL cross-origin iframe and postMessage round trip, and
// the REAL /api/dev-server/resolve-selection endpoint. Only the FIBER itself is faked (a hand-built object
// shaped like what react-dom actually attaches, `_debugSource` — the React <=18 shape, so this exercises the
// tier-2 ladder step without needing a source map fetch too): nothing else in the pipeline is stubbed, and
// nothing is installed in the target app beyond the one hand-built property this test's fixture attaches to
// prove the mechanism, which is exactly what a real React dev build's own `react-dom` would attach instead.
test.describe.serial('Live preview v2: click-to-source by reading React fiber internals (#443)', () => {
  let project;
  let restore;
  let pos; // the REAL parser's own line/column for BillingPage's root JSX element -- discovered, never guessed

  const card = (page) => page.getByTestId('dev-server');
  const frame = (page) => page.frameLocator('iframe[title="Live app preview"]');
  const pickButton = (page) => page.getByRole('button', { name: /Pick element|Picking…/ });
  const openBillingPage = async (page) => {
    await gotoCockpit(page, '/pages');
    const files = page.getByRole('complementary', { name: 'Browser' }).locator('.pages-browser');
    await files.locator('select').selectOption('billing');
    await files.getByRole('button', { name: 'BillingPage.tsx' }).click();
    await expect(page.locator('.live-preview-panel')).toBeVisible();
  };
  const startIt = async (page) => {
    await page.getByTestId('dev-server-start').click();
    await page.getByTestId('dev-server-confirm').click();
    await expect(card(page)).toHaveAttribute('data-state', 'running', { timeout: 30_000 });
  };

  test.beforeAll(async () => {
    project = makeBrowseProject('og443-fiber-');
    restore = await openProject(API, project.repo);

    // The REAL parser's own answer for BillingPage.tsx's root element -- reused verbatim below, so the
    // fake fiber names the exact position the Cockpit's own tree already agrees on, never a guess.
    const tree = await (await fetch(`${API}/api/pages/tree?feature=billing&file=BillingPage.tsx`)).json();
    const root = tree.roots[0];
    pos = { line: root.line, column: root.column };

    const fileName = JSON.stringify(path.join(project.repo, 'features/billing/pages/BillingPage.tsx'));
    const server = `import http from 'node:http';
const port = Number(process.env.PORT);
const html = '<!doctype html><html><body><button id="target">Ship it</button><script>'
  + 'window.addEventListener("DOMContentLoaded",function(){'
  + 'var el=document.getElementById("target");'
  + 'el.__reactFiber$e2e={type:function BillingPage(){},return:null,memoizedProps:{},'
  + '_debugSource:{fileName:${fileName},lineNumber:${pos.line},columnNumber:${pos.column}}};'
  + '});'
  + '</' + 'script></body></html>';
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); });
srv.on('error', (e) => { console.error(e.message); process.exit(1); });
srv.listen(port, '127.0.0.1', () => console.log('  Local:   http://localhost:' + port + '/'));
process.on('SIGTERM', () => srv.close(() => process.exit(0)));
`;
    fs.writeFileSync(path.join(project.repo, 'server.mjs'), server);
    fs.writeFileSync(path.join(project.repo, 'package.json'), JSON.stringify({ name: 'fixture-app', scripts: { dev: 'node server.mjs' } }));
    project.git('add', '-A');
    project.git('commit', '-q', '-m', 'fiber fixture app');
  });

  test.afterAll(async () => {
    await fetch(`${API}/api/dev-server/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await restore?.();
    project?.remove();
  });

  test('the injecting proxy, the fiber bridge, Pick mode, hover, select, Esc-sync and Alt+click all work with nothing installed in the target app', async ({ page, request }) => {
    test.setTimeout(120_000);
    await openBillingPage(page);
    await startIt(page);

    // --- the iframe frames the injecting proxy, never the dev server straight (#443 design note §3) ---
    const status = await (await request.get(`${API}/api/dev-server`)).json();
    expect(status.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(status.previewUrl).not.toBe(status.url);
    await expect(frame(page).locator('#target')).toBeVisible();
    // The fixture attaches the fake fiber from a `DOMContentLoaded` handler: wait for it explicitly rather
    // than assuming visibility implies it already ran.
    await expect.poll(() => frame(page).locator('#target').evaluate((el) => '__reactFiber$e2e' in el)).toBe(true);

    // --- Pick mode off: hover draws nothing, a plain click is left to the app ---
    await frame(page).locator('#target').hover();
    await expect.poll(() => frame(page).locator('#target').evaluate((el) => el.style.outline)).toBe('');

    // --- Pick mode on: hover outlines the real element (drawn entirely in-page by the bridge, #443) ---
    await pickButton(page).click();
    await expect(pickButton(page)).toHaveText('Picking…');
    await frame(page).locator('#target').hover();
    await expect.poll(() => frame(page).locator('#target').evaluate((el) => el.style.outline)).not.toBe('');

    // --- click while picking: a REAL postMessage round trip resolves through the REAL endpoint to the
    // REAL node the parser already agreed on, and the Cockpit's own tree/inspector select it ---
    await frame(page).locator('#target').click();
    await expect(page.locator('.live-preview-message')).toContainText('Selected BillingPage');

    // --- Esc pressed INSIDE the iframe exits Pick mode; the Cockpit learns this via the bridge's own
    // `picked` announcement (cross-origin means our keydown listener never sees that Esc directly, #443) ---
    await frame(page).locator('#target').focus(); // give the frame's own document focus, without clicking
    await page.keyboard.press('Escape');
    await expect(pickButton(page)).toHaveText('Pick element', { timeout: 5000 });

    // --- Alt+click still selects with Pick off (the bridge's own rule, never bypassed by the toggle) ---
    await frame(page).locator('#target').click({ modifiers: ['Alt'] });
    await expect(page.locator('.live-preview-message')).toContainText('Selected BillingPage');
  });
});
