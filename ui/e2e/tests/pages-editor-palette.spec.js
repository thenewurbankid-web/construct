import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #527 (Slice 1 of #518's design, docs/design/block-palette.md) — read-only Palette tab: the real
// Providers/Expressions/Components a feature's pages can reach, computed server-side from the real
// canImport graph (packages/engine/palette.mjs), never invented. `cart` owns a real Provider hook
// (named use<Name>Provider, built through defineProvider(...) — HOOK-002's real test), a real
// Expression and a real Component; `auth`'s own Provider is also reachable, but only because it is
// re-exported through auth's public index.ts (SLICE-002) — auth's un-re-exported `useAuthInternal`
// and billing's un-re-exported `InvoiceRow` must both stay invisible.
const CART_PROVIDER = `const CartProvider = { useProvider: () => ({ total: 0, itemCount: 0 }), ProviderComponent: (p) => p.children };
function defineProvider() { return CartProvider; }
const _p = defineProvider();
/** Shares { total, itemCount } from the cart service across this page's tree via React Context. */
export const useCartProvider = _p.useProvider;
export const CartProviderRoot = _p.ProviderComponent;
`;

const SHOW_FOR_ROLE = `/** Renders children only for a matching signed-in role. */
export function ShowForRole({ children }) {
  return children;
}
`;

const PROMO_CODE_FIELD = `/** A labelled text field with an Apply button. */
export function PromoCodeField() {
  return null;
}
`;

// #532 (Slice 2 of #518's design) -- a second, not-yet-used Component so the Insert tests exercise a
// genuinely fresh import + usage rather than one CartSummaryPage already has.
const CART_BADGE = `/** A small badge showing the cart's item count. */
export function CartBadge() {
  return null;
}
`;

const CART_SUMMARY_PAGE = `import { useCartProvider } from '../hooks/useCartProvider';
import { PromoCodeField } from '../components/PromoCodeField';

export default function CartSummaryPage() {
  const { total } = useCartProvider();
  return (
    <div>
      <PromoCodeField />
      <span>{total}</span>
    </div>
  );
}
`;

const AUTH_PROVIDER = `const AuthProvider = { useProvider: () => ({ user: null }), ProviderComponent: (p) => p.children };
function defineProvider() { return AuthProvider; }
const _a = defineProvider();
/** Shares the signed-in customer. */
export const useAuthProvider = _a.useProvider;
export const AuthProviderRoot = _a.ProviderComponent;
export function useAuthInternal() { return null; }
`;

const AUTH_INDEX = `export { useAuthProvider, AuthProviderRoot } from './hooks/useAuthProvider';\n`;

const BILLING_INVOICE_ROW = `export function InvoiceRow() { return null; }\n`;
const BILLING_INDEX = `export {};\n`;

test.describe.serial('Pages Editor Palette tab (#527)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-palette-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'CartSummary', feature: 'cart', layer: 'page' } });

    fs.mkdirSync(path.join(tmpProjectDir, 'features/cart/hooks'), { recursive: true });
    fs.mkdirSync(path.join(tmpProjectDir, 'features/cart/expressions'), { recursive: true });
    fs.mkdirSync(path.join(tmpProjectDir, 'features/cart/components'), { recursive: true });
    fs.mkdirSync(path.join(tmpProjectDir, 'features/auth/hooks'), { recursive: true });
    fs.mkdirSync(path.join(tmpProjectDir, 'features/billing/components'), { recursive: true });

    fs.writeFileSync(path.join(tmpProjectDir, 'features/cart/hooks/useCartProvider.ts'), CART_PROVIDER);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/cart/expressions/ShowForRole.tsx'), SHOW_FOR_ROLE);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/cart/components/PromoCodeField.tsx'), PROMO_CODE_FIELD);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/cart/components/CartBadge.tsx'), CART_BADGE);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/cart/pages/CartSummaryPage.tsx'), CART_SUMMARY_PAGE);

    fs.writeFileSync(path.join(tmpProjectDir, 'features/auth/hooks/useAuthProvider.ts'), AUTH_PROVIDER);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/auth/index.ts'), AUTH_INDEX);

    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/components/InvoiceRow.tsx'), BILLING_INVOICE_ROW);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/index.ts'), BILLING_INDEX);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('API: /api/pages/palette returns the real groups for the feature, cross-feature reachability included', async ({ request }) => {
    const r = await request.get(`${API_BASE}/api/pages/palette?feature=cart`);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.providers.map((p) => p.name).sort()).toEqual(['useAuthProvider', 'useCartProvider']);
    const own = body.providers.find((p) => p.name === 'useCartProvider');
    expect(own.via).toBeNull();
    const cross = body.providers.find((p) => p.name === 'useAuthProvider');
    expect(cross.via).toBe("auth's public index");
    expect(body.providers.some((p) => p.name === 'useAuthInternal')).toBe(false);
    expect(body.expressions.map((e) => e.name)).toEqual(['ShowForRole']);
    expect(body.components.map((c) => c.name).sort()).toEqual(['CartBadge', 'PromoCodeField']);
    expect(body.components.some((c) => c.name === 'InvoiceRow')).toBe(false);
  });

  test('Palette tab: three real groups render, plus the layer boundary line', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('cart');
    await page.getByRole('button', { name: 'CartSummaryPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'Palette' }).click();
    const panel = page.locator('.pal-panel');
    await expect(panel).toBeVisible();

    // Providers this feature can use: own (CartProvider) + cross-feature (AuthProvider via auth's index).
    const providers = panel.locator('.pal-group', { hasText: 'Providers this feature can use' });
    await expect(providers.locator('.pal-count')).toHaveText('2');
    await expect(providers.locator('.pal-name b', { hasText: /^useCartProvider$/ })).toBeVisible();
    await expect(providers.locator('.pal-item', { hasText: 'useCartProvider' })).toContainText(
      "Shares { total, itemCount } from the cart service across this page's tree via React Context.",
    );
    await expect(providers.locator('.pal-name b', { hasText: /^useAuthProvider$/ })).toBeVisible();
    await expect(providers.locator('.pal-item', { hasText: 'useAuthProvider' })).toContainText("via its public index");
    await expect(providers.locator('.pal-name b', { hasText: /^useAuthInternal$/ })).toHaveCount(0);
    await expect(providers.locator('.pal-chip').first()).toHaveText('provider');

    // Expressions this feature can wrap with.
    const expressions = panel.locator('.pal-group', { hasText: 'Expressions this feature can wrap with' });
    await expect(expressions.locator('.pal-count')).toHaveText('1');
    await expect(expressions.locator('.pal-name b', { hasText: /^ShowForRole$/ })).toBeVisible();
    await expect(expressions.locator('.pal-chip')).toHaveText('expression');

    // Components this feature can compose (billing's un-re-exported InvoiceRow must not appear).
    const components = panel.locator('.pal-group', { hasText: 'Components this feature can compose' });
    await expect(components.locator('.pal-count')).toHaveText('2');
    await expect(components.locator('.pal-name b', { hasText: /^PromoCodeField$/ })).toBeVisible();
    await expect(components.locator('.pal-name b', { hasText: /^CartBadge$/ })).toBeVisible();
    await expect(components.locator('.pal-name b', { hasText: /^InvoiceRow$/ })).toHaveCount(0);
    await expect(components.locator('.pal-chip').first()).toHaveText('component');

    // The boundary line: what a page can never reach, stated in plain language.
    const boundary = panel.locator('.pal-boundary');
    await expect(boundary).toBeVisible();
    await expect(boundary).toContainText('Not shown here');
    await expect(boundary).toContainText('workflows, services and domain logic');
    await expect(boundary).toContainText('PAGE-002/003/005');
  });

  // #532 (Slice 2 of #518's design) -- Slice 1's read-only rendering above must stay unchanged
  // (strictly additive): Expression rows get no Insert action (Slice 3, "Wrap with...", is separate).
  test("Slice 1 stays read-only where it should: no Insert action on Expression rows", async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('cart');
    await page.getByRole('button', { name: 'CartSummaryPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Palette' }).click();

    const expressions = page.locator('.pal-panel .pal-group', { hasText: 'Expressions this feature can wrap with' });
    await expect(expressions.locator('.pal-item', { hasText: 'ShowForRole' })).toBeVisible();
    await expect(expressions.getByRole('button', { name: 'Insert' })).toHaveCount(0);
  });

  test('Insert: clicking a fresh Component adds its real import + JSX usage to the page file (#532)', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('cart');
    await page.getByRole('button', { name: 'CartSummaryPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Palette' }).click();

    const components = page.locator('.pal-panel .pal-group', { hasText: 'Components this feature can compose' });
    const row = components.locator('.pal-item', { hasText: 'CartBadge' });
    await expect(row.getByRole('button', { name: 'Insert' })).toBeVisible();

    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/palette/insert') && res.request().method() === 'POST'),
      row.getByRole('button', { name: 'Insert' }).click(),
    ]);
    await expect(page.locator('.pal-panel .status-ok')).toContainText('Inserted CartBadge.');

    const fileContent = fs.readFileSync(path.join(tmpProjectDir, 'features/cart/pages/CartSummaryPage.tsx'), 'utf8');
    expect(fileContent).toMatch(/import \{ CartBadge \} from '\.\.\/components\/CartBadge';/);
    expect(fileContent).toMatch(/<CartBadge \s*\/>/);
  });

  test('Insert: clicking a cross-feature Provider adds the PUBLIC-index import + a hook-call statement (#532)', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('cart');
    await page.getByRole('button', { name: 'CartSummaryPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Palette' }).click();

    const providers = page.locator('.pal-panel .pal-group', { hasText: 'Providers this feature can use' });
    const row = providers.locator('.pal-item', { hasText: 'useAuthProvider' });
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/palette/insert') && res.request().method() === 'POST'),
      row.getByRole('button', { name: 'Insert' }).click(),
    ]);
    await expect(page.locator('.pal-panel .status-ok')).toContainText('Inserted useAuthProvider.');

    const fileContent = fs.readFileSync(path.join(tmpProjectDir, 'features/cart/pages/CartSummaryPage.tsx'), 'utf8');
    // Cross-feature: the OTHER feature's public index.ts, never its internal hooks/ file (SLICE-002).
    expect(fileContent).toMatch(/import \{ useAuthProvider \} from '\.\.\/\.\.\/auth\/index';/);
    expect(fileContent).not.toMatch(/auth\/hooks\/useAuthProvider/);
    expect(fileContent).toMatch(/const auth = useAuthProvider\(\);/);
  });
});
