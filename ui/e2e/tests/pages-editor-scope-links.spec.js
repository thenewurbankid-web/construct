import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #223 — scope/binding link panel. `Card` gets `title` and `total` from page scope, a literal `label`
// it does not declare, and leaves `onClose`/`open` unbound (`open` is in page scope). `Foo.Bar` is a
// compound child resolved from its imported file. `setOpen`/`draft`-style names never passed are
// flagged unused.
const FIXTURE_PAGE = `import React, { useState } from 'react';
import { Card } from '../components/Card';
import { Foo } from '../components/Foo';

export default function ProfilePage({ title, count }: { title: string; count: number }) {
  const [open, setOpen] = useState(false);

  return (
    <main>
      <Card title={title} total={count + 1} label="hi" />
      <Foo.Bar size={count} />
    </main>
  );
}
`;

const CARD = `export function Card({ title, total, onClose, open }: { title: string; total: number; onClose?: () => void; open?: boolean }) {
  return <div>{title}{total}</div>;
}
`;

const FOO = `export function Foo() { return null; }
export function Bar({ size, tone }: { size: number; tone?: string }) {
  return <span>{size}{tone}</span>;
}
`;

// #529 -- a real page that imports a real Provider hook (provider.ts's own documented shape: a local
// `defineProvider<Props, Value>(...)` binding, re-exported as `use<Name>Provider = X.useProvider`) so
// its exposed fields (`total`, `label`) come back as `'provider'`-kind scope sources end to end,
// through ui/server's actual getScopeLinks REST endpoint -- not just from a direct buildScopeLinks
// unit test. A component distinct from `CARD` above, since that one deliberately leaves `label`
// undeclared for the (#223) undeclared-prop assertions and must stay untouched.
const CART_PROVIDER_HOOK = `interface CartProviderProps { total: number }
interface CartValue { total: number; label: string }
const CartProvider = defineProvider<CartProviderProps, CartValue>('Cart', ({ total }) => ({ total, label: 'x' }));
export const useCartProvider = CartProvider.useProvider;
`;

const CART_CARD = `export function CartCard({ title, amount, label }: { title: string; amount: number; label: string }) {
  return <div>{title}{amount}{label}</div>;
}
`;

const CART_PAGE = `import { CartCard } from '../components/CartCard';
import { useCartProvider } from '../hooks/useCartProvider';

export default function CartPage({ title }: { title: string }) {
  return (
    <main>
      <CartCard title={title} amount={total} label={label} />
    </main>
  );
}
`;

test.describe.serial('Pages Editor scope links (#223)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-scope-links-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Profile', feature: 'people', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/pages/ProfilePage.tsx'), FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/people/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/components/Card.tsx'), CARD);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/components/Foo.tsx'), FOO);
    // #529 fixture: a second page in the same feature, importing a real Provider hook.
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/pages/CartPage.tsx'), CART_PAGE);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/components/CartCard.tsx'), CART_CARD);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/people/hooks'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/hooks/useCartProvider.ts'), CART_PROVIDER_HOOK);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('scope-links.png — links, unbound/undeclared flags, compound child', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('people');
    await page.getByRole('button', { name: 'ProfilePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.locator('.tree-panel').getByText('<Card>', { exact: true }).click();
    // Scope links are their own tab of the shell's Tools panel (#247), no longer inline under the inspector.
    await page.getByRole('tab', { name: 'Scope' }).click();
    const panel = page.locator('.scope-panel');
    await expect(panel).toBeVisible();

    // Colour-coded links from page scope into Card's props.
    await expect(panel.locator('path.scope-edge[data-from="title"][data-to="title"]')).toHaveCount(1);
    await expect(panel.locator('path.scope-edge[data-from="count"][data-to="total"]')).toHaveCount(1);
    await expect(panel.locator('.scope-target.scope-status-unbound')).toHaveCount(2);
    await expect(panel.locator('.scope-target.scope-status-undeclared')).toContainText('label');
    await expect(panel.locator('.scope-flag-warn', { hasText: 'Unbound prop "open"' })).toContainText('auto-map');
    await expect(panel.locator('.scope-flag-info', { hasText: '"setOpen" is declared but never passed' })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-scope-links.png') });

    // Compound child Foo.Bar: `size` linked from `count`, `tone` unbound.
    await page.locator('.tree-panel').getByText('<Foo.Bar>', { exact: true }).click();
    await expect(panel.locator('path.scope-edge[data-from="count"][data-to="size"]')).toHaveCount(1);
    await expect(panel.locator('.scope-flag-warn', { hasText: 'Unbound prop "tone"' })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-scope-links-compound.png') });
  });

  test('scope-links-provider.png — a real Provider hook\'s exposed fields surface as \'provider\' scope sources (#529)', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('people');
    await page.getByRole('button', { name: 'CartPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.locator('.tree-panel').getByText('<CartCard>', { exact: true }).click();
    await page.getByRole('tab', { name: 'Scope' }).click();
    const panel = page.locator('.scope-panel');
    await expect(panel).toBeVisible();

    // The Provider hook's own exposed fields (`total`, `label`) show up as their own scope-source
    // kind, distinct from a plain page prop -- proving ui/server's getScopeLinks actually resolved
    // and read features/people/hooks/useCartProvider.ts across the import, not just that the engine
    // supports it in isolation.
    await expect(panel.locator('.scope-source.scope-kind-provider')).toHaveCount(2);
    await expect(panel.locator('.scope-source.scope-kind-provider')).toContainText(['total', 'label']);
    await expect(panel.locator('.scope-source.scope-kind-prop')).toContainText(['title']);

    // Wired straight through: the page's own `total`/`label` identifiers (bound to the Provider's
    // fields, not page props) link into CartCard's `amount`/`label` props -- so nothing is left
    // 'undeclared' even though neither name is a prop or state of CartPage itself.
    await expect(panel.locator('path.scope-edge[data-from="total"][data-to="amount"]')).toHaveCount(1);
    await expect(panel.locator('path.scope-edge[data-from="label"][data-to="label"]')).toHaveCount(1);
    await expect(panel.locator('.scope-target.scope-status-undeclared')).toHaveCount(0);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-scope-links-provider.png') });
  });
});
