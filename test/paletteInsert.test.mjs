import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPalette } from '../packages/engine/palette.mjs';
import { buildPaletteInsertion, buildComponentUsageJsx, buildProviderUsageStatement } from '../ui/server/src/pagesEditor.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

// #532 (Slice 2 of #518's design, docs/design/block-palette.md) -- clicking a Component/Provider
// Palette entry (#527) inserts its real import + usage at the end of the currently open page.
// Expressions are explicitly out of scope (Slice 3, "Wrap with...", #517).
function project() {
  const dir = makeTempDir('construct-palette-insert-');
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
  write(
    'features/cart/components/PromoCodeField.tsx',
    `type Props = { code: string; onApply: () => void; label?: string };\n` +
      `/** A labelled text field with an Apply button. */\n` +
      `export function PromoCodeField({ code, onApply }: Props) { return <button onClick={onApply}>{code}</button>; }\n`,
  );
  write(
    'features/cart/pages/CartSummaryPage.tsx',
    `export default function CartSummaryPage() {\n` +
      `  return (\n` +
      `    <div>\n` +
      `      <span>Cart</span>\n` +
      `    </div>\n` +
      `  );\n` +
      `}\n`,
  );
  write(
    'features/cart/pages/SelfClosingPage.tsx',
    `import { PromoCodeField } from '../components/PromoCodeField';\n\nexport default function SelfClosingPage() {\n  return <PromoCodeField code="" onApply={() => {}} />;\n}\n`,
  );
  write(
    'features/cart/pages/ArrowExprPage.tsx',
    `const ArrowExprPage = () => (\n  <div>\n    <span>Cart</span>\n  </div>\n);\nexport default ArrowExprPage;\n`,
  );

  write(
    'features/auth/hooks/useAuthProvider.ts',
    `const AuthProvider = { useProvider: () => ({ user: null }), ProviderComponent: () => null };\n` +
      `function defineProvider() { return AuthProvider; }\n` +
      `const _a = defineProvider();\n` +
      `export const useAuthProvider = _a.useProvider;\n` +
      `export const AuthProviderRoot = _a.ProviderComponent;\n`,
  );
  write('features/auth/index.ts', `export { useAuthProvider, AuthProviderRoot } from './hooks/useAuthProvider';\n`);

  return dir;
}

function pageAbsPath(dir, file = 'features/cart/pages/CartSummaryPage.tsx') {
  return path.join(dir, file);
}

test('component: own-feature import added + required props stubbed, appended as last child of the root', async () => {
  const dir = project();
  const palette = buildPalette(dir, 'cart');
  const entry = palette.components.find((c) => c.name === 'PromoCodeField');
  assert.ok(entry);

  const abs = pageAbsPath(dir);
  const source = fs.readFileSync(abs, 'utf8');
  const result = await buildPaletteInsertion(dir, abs, source, { ...entry, kind: 'component' });
  assert.equal(result.ok, true, result.error);
  assert.match(result.source, /import \{ PromoCodeField \} from '\.\.\/components\/PromoCodeField';/);
  // Required props (code, onApply) stubbed; optional (label) left out.
  assert.match(result.source, /<PromoCodeField code="" onApply=\{\(\) => \{\}\} \/>/);
  assert.equal(result.source.match(/<PromoCodeField /g)?.length, 1);
  // Inserted before the root's closing tag, inside the existing <div>.
  assert.ok(result.source.indexOf('<PromoCodeField') > result.source.indexOf('<span>Cart</span>'));
  assert.ok(result.source.indexOf('<PromoCodeField') < result.source.lastIndexOf('</div>'));
});

test('component: clicking twice inserts two usages but only one import line', async () => {
  const dir = project();
  const palette = buildPalette(dir, 'cart');
  const entry = palette.components.find((c) => c.name === 'PromoCodeField');
  const abs = pageAbsPath(dir);
  const once = await buildPaletteInsertion(dir, abs, fs.readFileSync(abs, 'utf8'), { ...entry, kind: 'component' });
  assert.equal(once.ok, true);
  const twice = await buildPaletteInsertion(dir, abs, once.source, { ...entry, kind: 'component' });
  assert.equal(twice.ok, true, twice.error);
  assert.equal(twice.source.match(/import \{ PromoCodeField \}/g)?.length, 1);
  assert.equal(twice.source.match(/<PromoCodeField /g)?.length, 2);
});

test('provider: own-feature hook call inserted as the first statement of the component body', async () => {
  const dir = project();
  const palette = buildPalette(dir, 'cart');
  const entry = palette.providers.find((p) => p.name === 'useCartProvider');
  assert.ok(entry);
  const abs = pageAbsPath(dir);
  const result = await buildPaletteInsertion(dir, abs, fs.readFileSync(abs, 'utf8'), { ...entry, kind: 'provider' });
  assert.equal(result.ok, true, result.error);
  assert.match(result.source, /import \{ useCartProvider \} from '\.\.\/hooks\/useCartProvider';/);
  const bodyOpen = result.source.indexOf('{', result.source.indexOf('CartSummaryPage'));
  const stmtAt = result.source.indexOf('const cart = useCartProvider();');
  const returnAt = result.source.indexOf('return');
  assert.ok(stmtAt > bodyOpen && stmtAt < returnAt, 'hook call sits between the body open brace and the return');
});

test('provider: cross-feature import resolves to the OTHER feature\'s public index, never its internals', async () => {
  const dir = project();
  const palette = buildPalette(dir, 'cart');
  const entry = palette.providers.find((p) => p.name === 'useAuthProvider');
  assert.ok(entry);
  assert.equal(entry.via, "auth's public index");
  const abs = pageAbsPath(dir);
  const result = await buildPaletteInsertion(dir, abs, fs.readFileSync(abs, 'utf8'), { ...entry, kind: 'provider' });
  assert.equal(result.ok, true, result.error);
  assert.match(result.source, /import \{ useAuthProvider \} from '\.\.\/\.\.\/auth\/index';/);
  assert.doesNotMatch(result.source, /auth\/hooks\/useAuthProvider/);
  assert.match(result.source, /const auth = useAuthProvider\(\);/);
});

test('expression kind is rejected -- Slice 3 ("Wrap with...") is a separate, later ticket', async () => {
  const dir = project();
  const abs = pageAbsPath(dir);
  const result = await buildPaletteInsertion(dir, abs, fs.readFileSync(abs, 'utf8'), { name: 'X', path: 'features/cart/expressions/X.tsx', feature: 'cart', via: null, kind: 'expression' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Slice 3/);
});

test('a self-closing page root rejects a Component insert, not a silent corruption', async () => {
  const dir = project();
  const palette = buildPalette(dir, 'cart');
  const entry = palette.components.find((c) => c.name === 'PromoCodeField');
  const abs = pageAbsPath(dir, 'features/cart/pages/SelfClosingPage.tsx');
  const result = await buildPaletteInsertion(dir, abs, fs.readFileSync(abs, 'utf8'), { ...entry, kind: 'component' });
  assert.equal(result.ok, false);
  assert.match(result.error, /self-closing/);
});

test('a Provider insert into an expression-bodied arrow (no block to insert into) is a clean rejection', async () => {
  const dir = project();
  const palette = buildPalette(dir, 'cart');
  const entry = palette.providers.find((p) => p.name === 'useCartProvider');
  const abs = pageAbsPath(dir, 'features/cart/pages/ArrowExprPage.tsx');
  const result = await buildPaletteInsertion(dir, abs, fs.readFileSync(abs, 'utf8'), { ...entry, kind: 'provider' });
  assert.equal(result.ok, false);
  assert.match(result.error, /own component function/);
});

test('a name already imported from somewhere else is a clean rejection, not a silent overwrite', async () => {
  const dir = project();
  const palette = buildPalette(dir, 'cart');
  const entry = palette.components.find((c) => c.name === 'PromoCodeField');
  const abs = pageAbsPath(dir);
  const clashing = `import { PromoCodeField } from '../../billing/index';\n\n` + fs.readFileSync(abs, 'utf8');
  const result = await buildPaletteInsertion(dir, abs, clashing, { ...entry, kind: 'component' });
  assert.equal(result.ok, false);
  assert.match(result.error, /already imported/);
});

test('buildComponentUsageJsx: stub values by real react-docgen type text', () => {
  const described = {
    components: [
      {
        name: 'Widget',
        props: [
          { name: 'label', type: 'string', required: true },
          { name: 'count', type: 'number', required: true },
          { name: 'active', type: 'boolean', required: true },
          { name: 'items', type: 'string[]', required: true },
          { name: 'config', type: '{ a: number }', required: true },
          { name: 'onClick', type: '() => void', required: true },
          { name: 'mystery', type: 'SomeBrandedType', required: true },
          { name: 'optional', type: 'string', required: false },
        ],
      },
    ],
  };
  const jsx = buildComponentUsageJsx('Widget', described);
  assert.equal(jsx, '<Widget label="" count={0} active={false} items={[]} config={{}} onClick={() => {}} mystery={undefined} />');
});

test('buildComponentUsageJsx: no required props -> a bare self-closing tag', () => {
  assert.equal(buildComponentUsageJsx('Bare', { components: [{ name: 'Bare', props: [] }] }), '<Bare />');
  assert.equal(buildComponentUsageJsx('Unknown', null), '<Unknown />');
});

test('buildProviderUsageStatement: a sensible local variable name from the hook name', () => {
  assert.equal(buildProviderUsageStatement('useCartProvider'), 'const cart = useCartProvider();');
  assert.equal(buildProviderUsageStatement('useAuthProvider'), 'const auth = useAuthProvider();');
  assert.equal(buildProviderUsageStatement('useProvider'), 'const value = useProvider();');
});
