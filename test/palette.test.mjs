import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPalette } from '../packages/engine/palette.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

// #527 (Slice 1 of #518's design) -- the Pages editor Palette tab's read model: Providers,
// Expressions and Components a feature's pages can actually reach, computed from real files (the
// canImport graph + the Provider naming convention + a real `defineProvider(...)` call), never a
// hand-maintained list.
function project() {
  const dir = makeTempDir('construct-palette-');
  const write = (rel, content) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  write('architecture.yml', 'features:\n  root: features\n');

  write(
    'features/cart/hooks/useCartProvider.ts',
    `const CartProvider = { useProvider: () => ({ total: 0 }), ProviderComponent: () => null };\n` +
      `function defineProvider() { return CartProvider; }\n` +
      `const _p = defineProvider();\n` +
      `/** Shares cart totals with this page's tree via React Context. */\n` +
      `export const useCartProvider = _p.useProvider;\n` +
      `export const CartProviderRoot = _p.ProviderComponent;\n`,
  );
  // A hook named like a Provider but never built through defineProvider(...) -- HOOK-002 would flag
  // this, and the palette must not list it either (same real-not-invented bar).
  write('features/cart/hooks/useFakeProvider.ts', `export function useFakeProvider() { return null; }\n`);
  write('features/cart/expressions/ShowForRole.tsx', `/** Renders children only for a matching role. */\nexport function ShowForRole({ children }) { return children; }\n`);
  write('features/cart/components/PromoCodeField.tsx', `/** A labelled text field with an Apply button. */\nexport function PromoCodeField() { return null; }\n`);
  write('features/cart/pages/CartSummaryPage.tsx', `export default function CartSummaryPage() { return null; }\n`);

  write(
    'features/auth/hooks/useAuthProvider.ts',
    `const AuthProvider = { useProvider: () => ({ user: null }), ProviderComponent: () => null };\n` +
      `function defineProvider() { return AuthProvider; }\n` +
      `const _a = defineProvider();\n` +
      `export const useAuthProvider = _a.useProvider;\n` +
      `export const AuthProviderRoot = _a.ProviderComponent;\n` +
      `export function useAuthInternal() { return null; }\n`,
  );
  write('features/auth/index.ts', `export { useAuthProvider, AuthProviderRoot } from './hooks/useAuthProvider';\n`);
  // Not re-exported by billing's public index -- must stay unreachable from cart.
  write('features/billing/components/InvoiceRow.tsx', `export function InvoiceRow() { return null; }\n`);
  write('features/billing/index.ts', `export {};\n`);

  return dir;
}

test('own feature: real Provider (named + defineProvider-built), Expression and Component', () => {
  const dir = project();
  const r = buildPalette(dir, 'cart');
  assert.equal(r.ok, true);
  const own = r.providers.filter((p) => p.via === null);
  assert.deepEqual(own.map((p) => p.name), ['useCartProvider']);
  assert.equal(own[0].feature, 'cart');
  assert.match(own[0].description, /cart totals/);
  assert.deepEqual(r.expressions.map((e) => e.name), ['ShowForRole']);
  assert.deepEqual(r.components.map((c) => c.name), ['PromoCodeField']);
});

test('a Provider-named hook not built through defineProvider(...) is never listed', () => {
  const dir = project();
  const r = buildPalette(dir, 'cart');
  assert.ok(!r.providers.some((p) => p.name === 'useFakeProvider'));
});

test('cross-feature: only what the other feature\'s public index actually re-exports', () => {
  const dir = project();
  const r = buildPalette(dir, 'cart');
  const auth = r.providers.find((p) => p.name === 'useAuthProvider');
  assert.ok(auth, 'useAuthProvider reachable via features/auth/index.ts');
  assert.equal(auth.via, "auth's public index");
  assert.equal(auth.feature, 'auth');
  // A real export of auth's provider hook file that the public index does NOT re-export.
  assert.ok(!r.providers.some((p) => p.name === 'useAuthInternal'));
  // billing's index.ts re-exports nothing -- InvoiceRow must not appear for cart.
  assert.ok(!r.components.some((c) => c.name === 'InvoiceRow'));
});

test('unknown feature is a clean error, not a throw', () => {
  const dir = project();
  const r = buildPalette(dir, 'does-not-exist');
  assert.equal(r.ok, false);
  assert.match(r.error, /No such feature/);
});

test('same tree, same ref -> byte-identical output (deterministic, no LLM)', () => {
  const dir = project();
  assert.deepEqual(buildPalette(dir, 'cart'), buildPalette(dir, 'cart'));
});
