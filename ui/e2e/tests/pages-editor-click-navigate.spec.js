import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #321 — click to navigate, VS Code style, in the Pages editor. Resolved references are links that open
// IN the Cockpit with a breadcrumb trail; unresolved ones (a package outside the project, a component
// picked at run time) are plain text with no affordance at all.
const HOME = `import { PriceCard } from '../components';
import Badge from '../components/Badge';
import { Tooltip } from '@acme/legacy-ui';
import { Login } from '../../auth/components/Login';

export default function HomePage({ products, kind }) {
  const Banner = banners[kind];
  return (
    <main>
      <PriceCard product={products[0]} />
      <Badge />
      <Login />
      <Tooltip text="Prices include VAT" />
      <Banner />
    </main>
  );
}
`;

const FILES = {
  'features/catalog/pages/HomePage.tsx': HOME,
  'features/catalog/components/index.ts': "export { PriceCard } from './PriceCard';\n",
  'features/catalog/components/PriceCard.tsx': "import Badge from './Badge';\nimport { Icon } from './Icon';\n\nexport function PriceCard() {\n  return <div><Badge /><Icon /></div>;\n}\n",
  'features/catalog/components/Badge.tsx': "import { Chip1 } from './Chip1';\n\nexport default function Badge() {\n  return <Chip1 />;\n}\n",
  'features/catalog/components/Icon.tsx': 'export function Icon() {\n  return <i />;\n}\n',
  'features/catalog/components/Chip1.tsx': "import { Chip2 } from './Chip2';\nexport function Chip1() { return <Chip2 />; }\n",
  'features/catalog/components/Chip2.tsx': "import { Chip3 } from './Chip3';\nexport function Chip2() { return <Chip3 />; }\n",
  'features/catalog/components/Chip3.tsx': "import { Chip4 } from './Chip4';\nexport function Chip3() { return <Chip4 />; }\n",
  'features/catalog/components/Chip4.tsx': 'export function Chip4() { return <b />; }\n',
  'features/auth/components/Login.tsx': 'export function Login() {\n  return <button>Log in</button>;\n}\n',
};

test.describe.serial('Pages Editor click to navigate (#321)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-navigate-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'catalog', layer: 'page' } });
    for (const [rel, body] of Object.entries(FILES)) {
      fs.mkdirSync(path.dirname(path.join(tmpProjectDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmpProjectDir, rel), body);
    }
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  async function openHome(page) {
    await gotoCockpit(page, '/pages');
    await page.locator('.pages-browser select').selectOption('catalog');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.navigator-panel')).toBeVisible();
    await expect(page.getByTestId('trail-current')).toHaveText('HomePage');
    await expect(page.getByTestId('linked-code')).toContainText('export default function HomePage');
    await page.locator('.navigator-panel').scrollIntoViewIfNeeded();
  }

  const link = (page, name) => page.locator(`.ref-link[data-ref="${name}"]`);
  const trailNames = (page) => page.locator('.ref-trail-list .ref-crumb').allTextContents();

  test('resolved references are links with a dotted underline and a layer-labelled hover; unresolved ones are plain text', async ({ page }) => {
    await openHome(page);

    const priceCard = link(page, 'PriceCard').last();
    await expect(priceCard).toBeVisible();
    await expect(priceCard).toHaveCSS('cursor', 'pointer');
    await expect(priceCard).toHaveCSS('text-decoration-style', 'dotted');

    // Unresolved: no link markup of any kind for the package import, its JSX use, or the run-time component.
    for (const name of ['Tooltip', 'Banner']) await expect(link(page, name)).toHaveCount(0);
    const cursors = await page.evaluate(() => {
      const code = document.querySelector('[data-testid="linked-code"]');
      const out = {};
      for (const name of ['Tooltip', 'Banner']) {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let found = null;
        while (walker.nextNode()) {
          const i = walker.currentNode.textContent.indexOf(`<${name}`);
          if (i >= 0) { found = [walker.currentNode, i + 1]; break; }
        }
        const range = document.createRange();
        range.setStart(found[0], found[1]);
        range.setEnd(found[0], found[1] + name.length);
        const r = range.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        out[name] = { tag: el.tagName, cursor: getComputedStyle(el).cursor, underline: getComputedStyle(el).textDecorationLine };
      }
      return out;
    });
    for (const name of ['Tooltip', 'Banner']) {
      expect(cursors[name].tag).not.toBe('BUTTON');
      expect(cursors[name].cursor).not.toBe('pointer');
      expect(cursors[name].underline).toBe('none');
    }
    await expect(page.getByTestId('navigator-unlinked')).toContainText('Tooltip');
    await expect(page.getByTestId('navigator-unlinked')).toContainText('Banner');

    // Hover explains the relationship by layer; a cross-feature hop names the feature.
    await priceCard.hover();
    await expect(page.getByTestId('ref-tip')).toContainText('page -> component');
    await link(page, 'Login').last().hover();
    await expect(page.getByTestId('ref-tip')).toContainText('catalog -> auth');
    await page.locator('.navigator-panel h3').hover();
    await expect(page.getByTestId('ref-tip')).toHaveCount(0);

    // Ctrl held: links draw solid.
    await page.keyboard.down('Control');
    await expect(priceCard).toHaveCSS('text-decoration-style', 'solid');
    await page.keyboard.up('Control');

    // The unresolved ones are still diagnosable: logged at info level with a plain reason.
    const logs = await (await page.request.get(`${API_BASE}/api/logs`)).json();
    const nav = logs.entries.filter((e) => e.source === 'navigation');
    expect(nav.some((e) => e.level === 'info' && /Tooltip is not a link: @acme\/legacy-ui is a package outside this project/.test(e.text))).toBe(true);
    expect(nav.some((e) => /Banner is not a link: Banner is not imported/.test(e.text))).toBe(true);

    await page.locator('.navigator-panel').scrollIntoViewIfNeeded();
    await priceCard.hover();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-navigate-links.png') });
  });

  // #346: a resolved reference has a pointer cursor and an underline before any modifier, so a plain
  // click must open it ("looks clickable but does nothing" is a defect). Ctrl/Cmd-click and Enter still work.
  test('a plain click opens the reference in the Cockpit; Ctrl-click does too', async ({ page }) => {
    await openHome(page);
    await link(page, 'PriceCard').last().click();
    await expect(page.getByTestId('trail-current')).toHaveText('PriceCard');
    await expect(page.getByTestId('navigator-file')).toHaveText('features/catalog/components/PriceCard.tsx'); // through the barrel
    await expect(page.getByTestId('linked-code')).toContainText('export function PriceCard');

    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByTestId('trail-current')).toHaveText('HomePage');
    await link(page, 'PriceCard').last().click({ modifiers: ['Control'] });
    await expect(page.getByTestId('trail-current')).toHaveText('PriceCard');
  });

  test('three hops build the trail; Alt+Left / Alt+Right and the crumbs walk it; a new hop from the middle drops the forward steps', async ({ page }) => {
    await openHome(page);
    await link(page, 'PriceCard').last().click({ modifiers: ['Control'] });
    await expect(page.getByTestId('trail-current')).toHaveText('PriceCard');
    await expect(page.getByTestId('linked-code')).toContainText('export function PriceCard');
    await link(page, 'Badge').last().click({ modifiers: ['Control'] });
    await expect(page.getByTestId('trail-current')).toHaveText('Badge');
    await expect(page.getByTestId('navigator-file')).toHaveText('features/catalog/components/Badge.tsx');
    expect(await trailNames(page)).toEqual(['HomePage', 'PriceCard', 'Badge']);
    await expect(page.getByTestId('ref-trail')).toContainText('page -> component');
    await page.getByTestId('ref-trail').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-navigate-trail.png') });

    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByTestId('trail-current')).toHaveText('PriceCard');
    await expect(page.getByTestId('linked-code')).toContainText('export function PriceCard');
    expect(await trailNames(page)).toEqual(['HomePage', 'PriceCard', 'Badge']); // Badge stays as a forward step
    await expect(page.locator('.ref-crumb.ahead')).toHaveText('Badge');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-navigate-back.png') });
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.getByTestId('trail-current')).toHaveText('Badge');

    await page.getByRole('button', { name: 'HomePage', exact: true }).click();
    await expect(page.getByTestId('trail-current')).toHaveText('HomePage');
    await expect(page.getByRole('button', { name: 'Back (Alt+Left)' })).toBeDisabled();
    await page.getByRole('button', { name: 'Forward (Alt+Right)' }).click();
    await expect(page.getByTestId('trail-current')).toHaveText('PriceCard');

    // From the middle step (PriceCard) open a different reference: the forward step (Badge) is dropped.
    await link(page, 'Icon').last().click({ modifiers: ['Control'] });
    await expect(page.getByTestId('trail-current')).toHaveText('Icon');
    expect(await trailNames(page)).toEqual(['HomePage', 'PriceCard', 'Icon']);
    await expect(page.getByRole('button', { name: 'Forward (Alt+Right)' })).toBeDisabled();
  });

  test('a long trail folds its middle, reachable from a menu', async ({ page }) => {
    await openHome(page);
    await link(page, 'PriceCard').last().click({ modifiers: ['Control'] });
    await link(page, 'Badge').last().click({ modifiers: ['Control'] });
    for (const name of ['Chip1', 'Chip2', 'Chip3', 'Chip4']) {
      await link(page, name).last().click({ modifiers: ['Control'] });
      await expect(page.getByTestId('trail-current')).toHaveText(name);
    }
    // 7 steps: the first, a fold for the middle, the last hops.
    await expect(page.locator('.ref-trail-fold')).toHaveCount(1);
    await expect(page.locator('.ref-trail-list .ref-crumb', { hasText: 'PriceCard' })).toHaveCount(0);
    await page.locator('.ref-trail-fold button').click();
    await expect(page.getByRole('menuitem')).not.toHaveCount(0);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-navigate-fold.png') });
    await page.getByRole('menuitem', { name: 'PriceCard' }).click();
    await expect(page.getByTestId('trail-current')).toHaveText('PriceCard');
  });

  test('keyboard: Enter on a focused link opens it', async ({ page }) => {
    await openHome(page);
    await link(page, 'Login').last().focus();
    await expect(page.getByTestId('ref-tip')).toContainText('catalog -> auth');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('trail-current')).toHaveText('Login');
    await expect(page.getByTestId('linked-code')).toContainText('Log in');
  });
});
