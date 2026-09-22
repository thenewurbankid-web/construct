import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { caption, card, pause, saveRecording, saveCheckpoint, startTimeline, writeTimeline, installCursor, glide, highlight, loadDurations } from './support.mjs';

// Episode 1, Part 1 of the "every episode is built in parts" series (docs/MEDIA.md; #472, design: #474-477).
// A real run of the real Cockpit, real clicks only. Design: docs/design/mocks/episode1-*.html (#475/#476/#477).
//
// What is real vs. a stand-in, said honestly on screen:
//   - The static shop page (ShopHome.tsx), its wishlist heart/panel components, and the missing `onToggle` link are
//     real product code, added to a self-contained copy of the sample shop for this recording (never the real
//     ~/workspace/shop). The layout is adapted from Start Bootstrap "Shop Homepage"/"Shop Item" (MIT), vendored under
//     vendor/shop-template/ with its LICENSE.
//   - The "missing prop" evidence is TODAY's real Components screen (the props table from `describeComponent`,
//     react-docgen) — not the cross-referencing check the design mocks show (#473, not built yet). The caption says
//     so; this is the "closest real evidence today" #472 asks for when the ideal detection isn't ready.
//   - The demo login (GitHub OAuth cannot be automated in a recording).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../../site/assets/video');
const SLUG = '01a-meet-the-page';
const WS = process.env.E2E_WORKSPACE_ROOT;
const SAMPLE = process.env.E2E_SAMPLE_SHOP || path.join(os.homedir(), 'workspace', 'shop');
const SHOP_MODULES = process.env.E2E_SHOP_MODULES;
const APP_PORT = Number(process.env.E2E_APP_PORT) || 5821;
const FIXTURE = path.join(HERE, 'fixtures', 'episode1-shop');

export const CAPTIONS = {
  introTitle: 'Part 1: meet the page',
  introSub: 'Build a feature, start to finish — in parts',
  greeting: 'Hi there! This is part one of a short series. First, let us meet a page that looks like a real product, but does not work yet.',
  signIn: 'First, sign in. (This recording uses the demo login.)',
  gate: 'Open the sample shop.',
  features: 'The catalog feature already has a shop page in it, adapted from a real template, plus a wishlist heart and panel.',
  frozenNote: 'The page itself is frozen — wrapped, not rebuilt — so it does not even show up in this list.',
  fileHeart: 'The heart and panel are new, hand-authored components, so Construct documents them normally.',
  fileController: 'WishlistController: the wrapper. Right now it just forwards a fixed list of products.',
  routeNote: 'A new route, `/shop`, already points at it.',
  findingNote: 'One thing to look at: the wrapper is not exported from the feature yet.',
  pagesIntro: 'Here is that page in the Pages screen.',
  previewIntro: 'Now let us open it, running for real, full screen.',
  clickHeart: 'Try a heart. It renders, and it can be pressed. Nothing happens.',
  componentsIntro: 'Switch to Components and pick the heart button.',
  propsTable: 'Here is what it declares: `onToggle`, a callback. This table already exists today — Construct does not yet check whether any caller actually passes it.',
  gap473: 'Reading the page confirms it: `ShopHome` never passes it. That gap is filed as a real ticket, number 473.',
  validateIntro: 'Finally, the rules.',
  validateFinding: 'No errors. One real warning: the wrapper is not exported from the feature yet.',
  outroTitle: 'End of part one',
  outroSub: 'Next: wire up the wishlist, and bring the page to life',
  signOff: 'Next time, we wire it up. See you then.',
};

const rail = (page) => page.getByRole('navigation', { name: 'Screens', exact: true });
const drawer = (page) => page.getByRole('region', { name: 'Drawer' });
const browser = (page) => page.getByRole('complementary', { name: 'Browser' });

test('episode 1, part 1: meet the page', async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(OUT, { recursive: true });
  startTimeline();
  loadDurations(path.join(OUT, `${SLUG}.captions.json`));

  // A self-contained copy of the sample shop, plus the new static page and wishlist components overlaid on top.
  // The base sample (E2E_SAMPLE_SHOP or ~/workspace/shop) is only ever read; nothing is written back to it.
  const shop = path.join(WS, 'shop');
  fs.cpSync(SAMPLE, shop, { recursive: true, filter: (s) => !/[\\/](node_modules|\.next)([\\/]|$)/.test(s) });
  fs.cpSync(path.join(FIXTURE, 'vendor'), path.join(shop, 'vendor'), { recursive: true });
  fs.cpSync(path.join(FIXTURE, 'features'), path.join(shop, 'features'), { recursive: true });
  fs.mkdirSync(path.join(shop, 'app', 'shop'), { recursive: true });
  fs.writeFileSync(
    path.join(shop, 'app', 'shop', 'page.tsx'),
    "import { WishlistController } from '../../features/catalog/controllers/WishlistController';\n\nexport default function Page() {\n  return <WishlistController />;\n}\n",
  );
  // Declare the vendored page frozen (README.md's "Wrapping frozen, externally-authored UI"): Construct's
  // create/refactor/pipeline commands refuse to touch it from here on. The wishlist heart and panel are new,
  // hand-authored components (drawn to match the template, not copied from it), so they stay first-party and fully
  // visible to Construct's own tools — frozen files are skipped by Construct's layer rules AND its own Components
  // documentation (a real behaviour found while building this recording; filed as #478).
  fs.appendFileSync(path.join(shop, 'architecture.yml'), '\nfrozen:\n  - features/catalog/pages/ShopHome.tsx\n');
  if (SHOP_MODULES) execFileSync('cp', ['-al', SHOP_MODULES, path.join(shop, 'node_modules')]);
  else execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: shop });

  const app = spawn('npx', ['next', 'dev', '-p', String(APP_PORT)], { cwd: shop, stdio: 'ignore', detached: true });
  try {
    await installCursor(page);
    await page.goto('/');
    await expect(page.getByTestId('login-test-user')).toBeVisible();
    await card(page, CAPTIONS.introTitle, CAPTIONS.introSub, 5000, CAPTIONS.greeting);

    // 1. Sign in, open the sample shop (now carrying the new static page).
    await caption(page, CAPTIONS.signIn);
    await page.getByTestId('login-test-user').click();
    await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible();
    await caption(page, CAPTIONS.gate);
    await page.getByTestId('open-sample-shop').click();
    await expect(rail(page)).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Features');

    // 2. Features: the catalog feature's new files. ShopHome is frozen (README.md's "Wrapping frozen, externally-
    // authored UI"), so Construct's layer rules — and this file list — skip it entirely; WishlistHeartButton and
    // WishlistPanel are new, first-party components, so they show up normally, alongside the wrapper.
    await browser(page).getByRole('option').filter({ hasText: 'catalog' }).click();
    await expect(page.getByTestId('fc-name')).toHaveText('catalog');
    await caption(page, CAPTIONS.features);
    const files = page.getByTestId('fc-file');
    await caption(page, CAPTIONS.frozenNote);
    const heartFile = files.filter({ hasText: 'WishlistHeartButton.tsx' });
    await glide(page, heartFile);
    await highlight(page, heartFile, 'New, first-party, fully documented');
    await caption(page, CAPTIONS.fileHeart);
    const controllerFile = files.filter({ hasText: 'WishlistController.tsx' });
    await glide(page, controllerFile);
    await highlight(page, controllerFile, 'The wrapper');
    await caption(page, CAPTIONS.fileController);
    const shopRoute = page.getByTestId('fc-routes').getByText('/shop', { exact: true });
    await glide(page, shopRoute);
    await highlight(page, shopRoute, 'The new route');
    await caption(page, CAPTIONS.routeNote);
    const findings = page.getByRole('list', { name: 'Things to look at' });
    const unexported = findings.getByRole('listitem').filter({ hasText: 'index.ts' });
    await glide(page, unexported);
    await highlight(page, unexported, 'A real, honest warning');
    await caption(page, CAPTIONS.findingNote);

    // 3. Pages: the page itself, then running for real, full screen.
    await rail(page).getByRole('link', { name: 'Pages' }).click();
    await page.locator('.pages-browser select').selectOption('catalog');
    await page.getByRole('button', { name: 'ShopHome.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await caption(page, CAPTIONS.pagesIntro);
    await page.getByLabel('Preview URL').fill(`http://localhost:${APP_PORT}/shop`);
    await caption(page, CAPTIONS.previewIntro);
    await page.getByRole('button', { name: 'Load preview' }).click();
    const frame = page.frameLocator('iframe[title="Live app preview"]');
    await expect(frame.getByText('Shop in style')).toBeVisible({ timeout: 180_000 });
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(page.locator('.sh-top')).toHaveCount(0);
    const hearts = frame.locator('.sp-heart');
    await glide(page, hearts.first());
    await hearts.first().click();
    await caption(page, CAPTIONS.clickHeart);
    await page.getByRole('button', { name: 'Leave full screen (Esc)' }).click();
    await expect(page.locator('.sh-top')).toBeVisible();

    // 4. Components: the real props table, today's closest evidence for the missing link (#473 is the detection gap).
    await rail(page).getByRole('link', { name: 'Components' }).click();
    await caption(page, CAPTIONS.componentsIntro);
    await browser(page).getByRole('listbox', { name: 'Components' }).getByRole('option').filter({ hasText: 'WishlistHeartButton' }).click();
    const onToggleRow = page.getByTestId('cd-prop').filter({ hasText: 'onToggle' });
    await expect(onToggleRow).toBeVisible();
    await highlight(page, onToggleRow, 'Declared, never passed');
    await caption(page, CAPTIONS.propsTable);
    await caption(page, CAPTIONS.gap473);

    // 5. The rules: no errors, one real warning (the wrapper is not exported from the feature's index.ts yet).
    await expect(page.getByTestId('status-validate')).not.toContainText('checking', { timeout: 60_000 });
    await page.getByTestId('status-validate').click();
    await caption(page, CAPTIONS.validateIntro);
    await expect(drawer(page).getByText('SLICE-003')).toBeVisible();
    expect(await drawer(page).innerText()).not.toMatch(/^Error$/m);
    await highlight(page, drawer(page).getByText('SLICE-003').first(), 'Real warning, no errors');
    await caption(page, CAPTIONS.validateFinding);

    await card(page, CAPTIONS.outroTitle, CAPTIONS.outroSub, 5000, CAPTIONS.signOff);

    // Checkpoint for part 2: the project exactly as this part leaves it (this part never consumed one — it is first).
    saveCheckpoint(fs, shop, '01-a');

    const video = page.video();
    await page.close();
    const tmp = path.join(WS, '..', `${SLUG}.take.webm`);
    await video.saveAs(tmp);
    if (process.env.MEDIA_DRY !== '1') { saveRecording(fs, OUT, SLUG, tmp); writeTimeline(fs, OUT, SLUG); }
  } finally {
    try { process.kill(-app.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
});
