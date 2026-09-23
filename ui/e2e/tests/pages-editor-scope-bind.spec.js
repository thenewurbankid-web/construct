import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #534 -- the Scope tab's click-to-bind interaction (Slices 1+2): a target prop's row is a real
// button that arms it for linking; a fitting scope candidate (including a Provider-sourced one, the
// proof #528/#529's data actually reaches the UI) commits the rewire via the existing
// PropRow/AutoMapPanel mechanism (POST /api/pages/props); a type-mismatched candidate stays visible,
// disabled and dashed with its own real type -- never hidden.
//
// BindCard declares three props: `title` (bound already), `amount: number` and `label: string` (both
// declared but unpassed -- real 'unbound' targets to bind). The page's own scope has an untyped prop
// (`title`) and an untyped `useState` pair (`open`/`setOpen`) alongside a real Provider hook
// (`useCartProvider`, exposing `total: number` and `label: string`) -- so arming either target has
// both a real fitting Provider candidate AND a real, provably-mismatched candidate (the state setter,
// whose type is always `(value) => void`) to show disabled.
const FIXTURE_PAGE = `import { useState } from 'react';
import { BindCard } from '../components/BindCard';
import { useCartProvider } from '../hooks/useCartProvider';

export default function BindPage({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <BindCard title={title} />
    </main>
  );
}
`;

const BIND_CARD = `export function BindCard({ title, amount, label }: { title: string; amount: number; label: string }) {
  return <div>{title}{amount}{label}</div>;
}
`;

// Same real Provider hook shape used by pages-editor-scope-links.spec.js's #529 fixture.
const CART_PROVIDER_HOOK = `interface CartProviderProps { total: number }
interface CartValue { total: number; label: string }
const CartProvider = defineProvider<CartProviderProps, CartValue>('Cart', ({ total }) => ({ total, label: 'x' }));
export const useCartProvider = CartProvider.useProvider;
`;

test.describe.serial('Pages Editor Scope tab click-to-bind (#534)', () => {
  let tmpProjectDir;
  let pagePath;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-scope-bind-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Bind', feature: 'binder', layer: 'page' } });
    pagePath = path.join(tmpProjectDir, 'features/binder/pages/BindPage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/binder/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/binder/components/BindCard.tsx'), BIND_CARD);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/binder/hooks'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/binder/hooks/useCartProvider.ts'), CART_PROVIDER_HOOK);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  async function openBindCardScope(page) {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('binder');
    await page.getByRole('button', { name: 'BindPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<BindCard>', { exact: true }).click();
    await page.getByRole('tab', { name: 'Scope' }).click();
    const panel = page.locator('.scope-panel');
    await expect(panel).toBeVisible();
    return panel;
  }

  test('pointer path: arming amount shows a fitting Provider candidate and a real, dashed mismatch; clicking it rewires the source file', async ({ page }) => {
    const panel = await openBindCardScope(page);

    const amountTarget = panel.locator('.scope-target[data-prop="amount"]');
    await expect(amountTarget).toHaveCSS('cursor', 'pointer');
    await amountTarget.click();
    await expect(amountTarget).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.scope-callout')).toContainText('Linking: amount (number)');

    // The Provider's own `total` field (#528/#529's data) is a real, fitting candidate -- proof this
    // ticket's UI actually reads the provider-kind scope source, not just the original prop/state ones.
    const total = panel.locator('.scope-source[data-name="total"]');
    await expect(total).toBeEnabled();
    await expect(total).toHaveClass(/scope-fit/);

    // The state setter (`setOpen`, always `(value) => void`) is a REAL, provable mismatch against a
    // `number` prop -- shown, not hidden: visible, disabled, dashed, and its own real type in `title`.
    const setOpenCandidate = panel.locator('.scope-source[data-name="setOpen"]');
    await expect(setOpenCandidate).toBeVisible();
    await expect(setOpenCandidate).toBeDisabled();
    await expect(setOpenCandidate).toHaveClass(/scope-unfit/);
    await expect(setOpenCandidate).toHaveAttribute('title', /\(value\) => void/);

    // The Provider's OTHER field (`label: string`) is also a real, provable mismatch against `number`.
    const labelCandidate = panel.locator('.scope-source[data-name="label"]');
    await expect(labelCandidate).toBeDisabled();
    await expect(labelCandidate).toHaveClass(/scope-unfit/);

    await total.click();
    await expect(panel.locator('.status-ok')).toContainText('Bound "amount" to "total"');
    await expect(amountTarget).toHaveClass(/scope-status-bound/);
    await expect(amountTarget).toContainText('amount=total');

    // The real source file on disk, not just the UI's own re-render, was rewired.
    const source = fs.readFileSync(pagePath, 'utf8');
    expect(source).toMatch(/<BindCard title=\{title\} amount=\{total\}\/>/);
  });

  test('keyboard-only path: Tab/Enter/Arrow/Escape bind "label" to the Provider\'s own label field, with no mouse click', async ({ page }) => {
    const panel = await openBindCardScope(page);
    const labelTarget = panel.locator('.scope-target[data-prop="label"]');

    // Establish the starting focus the way a user who already tabbed here would have it (Playwright
    // has no way to script "the real Tab key from wherever the user's focus happens to be" without
    // walking the whole shell's tab order, which nothing else in this suite does either) -- every
    // step from here on is a real key press, never a click.
    await labelTarget.focus();
    await page.keyboard.press('Enter');
    await expect(labelTarget).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.scope-callout')).toContainText('Linking: label (string)');

    // Escape cancels -- a real keyboard-only path back out, not just a mouse affordance.
    await page.keyboard.press('Escape');
    await expect(panel.locator('.scope-callout')).toHaveCount(0);
    await expect(labelTarget).toHaveAttribute('aria-pressed', 'false');

    // Re-arm and this time commit: pressing Bind moves focus straight to the first enabled candidate
    // (never a disabled one, never nothing) -- this codebase's own real focus-management contract,
    // not Playwright's default focus order.
    await labelTarget.focus();
    await page.keyboard.press('Enter');
    const firstCandidate = panel.locator('.scope-source[data-name="title"]');
    await expect(firstCandidate).toBeFocused();

    // Arrow-navigate to the Provider's `label` field (the real candidate this arming's fit-filter
    // keeps enabled), skipping the disabled `setOpen`/`total` mismatches entirely, then commit it.
    await page.keyboard.press('ArrowDown'); // -> open
    await page.keyboard.press('ArrowDown'); // -> label (provider)
    const providerLabelCandidate = panel.locator('.scope-source.scope-kind-provider[data-name="label"]');
    await expect(providerLabelCandidate).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(panel.locator('.status-ok')).toContainText('Bound "label" to "label"');
    await expect(labelTarget).toHaveClass(/scope-status-bound/);
    await expect(labelTarget).toContainText('label=label');

    const source = fs.readFileSync(pagePath, 'utf8');
    expect(source).toMatch(/<BindCard title=\{title\} amount=\{total\} label=\{label\}\/>/);
  });
});
