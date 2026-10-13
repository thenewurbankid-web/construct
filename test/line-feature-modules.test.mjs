// #935 (part of #934): Line feature modules, Angular style. A feature exports through its public index
// (features/<f>/index.ts), another feature imports it only through that index (LINE-DIR), a based array fixture
// ({ "$lineBase", "value" }) passes LINE-BASE, and fixtures are scoped to the module (arrayFixtures, moduleScope).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { moduleEdges, fixtureRows } from '../packages/core/profiles/line/checks.mjs';
import { parseToAst } from '../packages/ast/index.mjs';
import { arrayFixtures } from '../packages/engine/line/basePage.mjs';
import { moduleScope } from '../packages/engine/line/moduleScope.mjs';
import { importableFiles } from '../packages/engine/line/typeGate.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'packages', 'core', 'profiles', 'line', 'fixtures');

/** A scratch copy of the passing Line fixture, with files added or replaced. */
function project(overlay = {}) {
  const dir = makeTempDir('construct-line-modules-');
  fs.cpSync(path.join(FIXTURES, 'passing'), dir, { recursive: true });
  for (const [rel, text] of Object.entries(overlay)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const where = (vs) => vs.map((v) => `${v.rule} ${v.file}:${v.line}`).sort();
const dirHits = (dir) => validateLine(dir, { rules: ['LINE-DIR', 'LINE-LAYOUT', 'LINE-BASE'] }).violations;

const ORDERS_INDEX = "export { OrderButton } from './components/OrderButton';\nexport { default as orders } from './fixtures/orders.json';\n";
const ORDERS_FIXTURE = `${JSON.stringify({ $lineBase: 'fixtures/products', value: [{ id: 'o1', name: 'First order', total: 3 }] }, null, 2)}\n`;
const PRODUCTS = `${JSON.stringify([{ id: 'p1', name: 'Shirt', price: 4 }], null, 2)}\n`;
const USES = (spec) => `// @line-base pages/ListPage\nimport { OrderButton } from '${spec}';\nexport default function Uses() { return String(OrderButton); }\n`;

test('LINE-DIR: a feature may import another feature through its public index, naming an export it has', () => {
  const dir = project({ 'features/orders/index.ts': ORDERS_INDEX, 'features/orders/fixtures/orders.json': ORDERS_FIXTURE, 'library/fixtures/products.json': PRODUCTS,
    'features/billing/pages/Uses.tsx': USES('../../orders') });
  assert.deepEqual(where(dirHits(dir)), []);
  // The index file named outright is the same public index.
  fs.writeFileSync(path.join(dir, 'features/billing/pages/Uses.tsx'), USES('../../orders/index'));
  assert.deepEqual(where(dirHits(dir)), []);
});

test('LINE-DIR: a deep import into another feature is refused and says to go through its index', () => {
  const dir = project({ 'features/orders/index.ts': ORDERS_INDEX, 'features/orders/fixtures/orders.json': ORDERS_FIXTURE, 'library/fixtures/products.json': PRODUCTS,
    'features/billing/pages/Uses.tsx': USES('../../orders/components/OrderButton') });
  const vs = dirHits(dir);
  assert.deepEqual(where(vs), ['LINE-DIR features/billing/pages/Uses.tsx:2']);
  assert.match(vs[0].message, /import it as `import \{ OrderButton \} from '\.\.\/\.\.\/orders'`/);
  assert.match(vs[0].why, /only through what that feature exports from its public index/);
});

test('LINE-DIR: an imported name the index does not export, a missing index and a stale export line are reported', () => {
  const missing = project({ 'features/orders/index.ts': "export { default as orders } from './fixtures/orders.json';\n", 'features/orders/fixtures/orders.json': ORDERS_FIXTURE,
    'library/fixtures/products.json': PRODUCTS, 'features/billing/pages/Uses.tsx': USES('../../orders') });
  const m = dirHits(missing);
  assert.deepEqual(where(m), ['LINE-DIR features/billing/pages/Uses.tsx:2']);
  assert.match(m[0].message, /imports "OrderButton" from feature "orders", but features\/orders\/index\.ts does not export it/);

  const none = project({ 'features/billing/pages/Uses.tsx': USES('../../orders') });
  assert.match(dirHits(none).find((v) => v.file === 'features/billing/pages/Uses.tsx')?.message ?? '', /has no public index; create features\/orders\/index\.ts/);

  const stale = project({ 'features/orders/index.ts': `${ORDERS_INDEX}export * from './components/Gone';\n`, 'features/orders/fixtures/orders.json': ORDERS_FIXTURE,
    'library/fixtures/products.json': PRODUCTS, 'features/billing/pages/Uses.tsx': USES('../../orders') });
  const s = dirHits(stale);
  assert.deepEqual(where(s), ['LINE-DIR features/orders/index.ts:3']);
  assert.match(s[0].message, /exports "\.\/components\/Gone", which does not exist/);
});

test('LINE-DIR: export * through a project file counts its names; the library still never imports a feature', () => {
  const dir = project({ 'features/orders/index.ts': "export * from './components';\n", 'features/billing/pages/Uses.tsx': USES('../../orders'),
    'library/components/Leak.tsx': "import { OrderButton } from '../../features/orders';\nexport function Leak() { return String(OrderButton); }\n" });
  assert.deepEqual(where(dirHits(dir)), ['LINE-DIR library/components/Leak.tsx:1']);
});

test('LINE-LAYOUT: a feature\'s index.ts may sit at its top level', () => {
  const dir = project({ 'features/orders/index.ts': ORDERS_INDEX });
  assert.deepEqual(dirHits(dir).filter((v) => v.rule === 'LINE-LAYOUT'), []);
});

test('LINE-BASE: a based array fixture { "$lineBase", "value" } passes; a bare array is told how to carry its base', () => {
  const ok = project({ 'library/fixtures/products.json': PRODUCTS, 'features/orders/fixtures/orders.json': ORDERS_FIXTURE });
  assert.deepEqual(validateLine(ok, { rules: ['LINE-BASE'] }).violations, []);
  const bare = project({ 'library/fixtures/products.json': PRODUCTS, 'features/orders/fixtures/orders.json': `${JSON.stringify([{ id: 'o1' }])}\n` });
  const [v] = validateLine(bare, { rules: ['LINE-BASE'] }).violations;
  assert.equal(v.file, 'features/orders/fixtures/orders.json');
  assert.match(v.message, /wrapping its rows as \{ "\$lineBase": "fixtures\/<name>", "value": \[ \.\.\.rows \] \}/);
  assert.deepEqual(fixtureRows([1]), [1]);
  assert.deepEqual(fixtureRows({ $lineBase: 'fixtures/x', value: [2] }), [2]);
  assert.equal(fixtureRows({ value: [2] }), null);
});

test('moduleEdges: names what each static import takes', () => {
  const edges = moduleEdges(parseToAst("import A, { b as c } from './x';\nimport * as ns from './y';\nexport { d } from './z';\nexport * from './w';\nconst m = require('./r');\n"));
  assert.deepEqual(edges.map((e) => [e.specifier, e.names]), [['./x', ['default', 'b']], ['./y', ['*']], ['./z', ['d']], ['./w', ['*']], ['./r', null]]);
});

test('arrayFixtures: a feature sees its own fixtures and those its imported modules export, then the library\'s', () => {
  const dir = project({
    'library/fixtures/products.json': PRODUCTS,
    'features/orders/index.ts': ORDERS_INDEX,
    'features/orders/fixtures/orders.json': ORDERS_FIXTURE,
    'features/billing/fixtures/invoices.json': `${JSON.stringify({ $lineBase: 'fixtures/products', value: [{ id: 'i1', name: 'Invoice', total: 9 }] })}\n`,
    'features/billing/pages/Uses.tsx': USES('../../orders'),
  });
  const layout = { library: 'library', features: 'features' };
  assert.deepEqual(arrayFixtures(dir, layout).map((f) => f.rel), ['library/fixtures/products.json'], 'no feature: the library only, as before');
  const seen = arrayFixtures(dir, layout, 'billing');
  assert.deepEqual(seen.map((f) => [f.rel, f.wrapped ?? false, f.via?.name ?? null]), [
    ['features/billing/fixtures/invoices.json', true, null],
    ['features/orders/fixtures/orders.json', true, 'orders'],
    ['library/fixtures/products.json', false, null],
  ]);
  assert.equal(seen[1].rows[0].id, 'o1');
  // A feature that imports nothing sees only its own and the library's.
  assert.deepEqual(arrayFixtures(dir, layout, 'orders').map((f) => f.rel), ['features/orders/fixtures/orders.json', 'library/fixtures/products.json']);
});

test('moduleScope: declares, exports, imports and visible fixtures of a two-feature project', () => {
  const dir = project({
    'library/fixtures/products.json': PRODUCTS,
    'features/orders/index.ts': ORDERS_INDEX,
    'features/orders/fixtures/orders.json': ORDERS_FIXTURE,
    'features/billing/pages/Uses.tsx': USES('../../orders'),
  });
  const orders = moduleScope(dir, 'orders');
  assert.equal(orders.index, 'features/orders/index.ts');
  assert.deepEqual(orders.exports, [{ name: 'OrderButton', file: 'features/orders/components/OrderButton.tsx' }, { name: 'orders', file: 'features/orders/fixtures/orders.json' }]);
  assert.deepEqual(orders.declares.components, [{ name: 'OrderButton', file: 'features/orders/components/OrderButton.tsx', base: 'components/Button' }]);
  assert.deepEqual(orders.declares.fixtures.map((i) => [i.name, i.base]), [['order', 'fixtures/user'], ['orders', 'fixtures/products']]);
  assert.deepEqual(orders.imports.features, []);
  assert.ok(orders.imports.library.some((l) => l.id === 'components/Button'));

  const billing = moduleScope(dir, 'billing');
  assert.equal(billing.index, null);
  assert.deepEqual(billing.exports, []);
  assert.deepEqual(billing.imports.features, [{ feature: 'orders', index: 'features/orders/index.ts', names: ['OrderButton'], by: ['features/billing/pages/Uses.tsx'] }]);
  assert.deepEqual(billing.imports.library.map((l) => l.id), ['pages/ListPage']);
  assert.deepEqual(billing.fixtures.map((f) => [f.file, f.from, f.export ?? null, f.rows]), [['features/orders/fixtures/orders.json', 'orders', 'orders', 1]]);
  assert.throws(() => moduleScope(dir, 'nope'), /no feature "nope"/);
});

test('importableFiles: a feature file may import another feature\'s public index, never its other files', () => {
  const dir = project({ 'features/orders/index.ts': ORDERS_INDEX });
  const files = importableFiles(dir, { library: 'library', features: 'features' }, 'features/billing/pages/InvoicesPage.tsx');
  assert.ok(files.includes('features/orders/index.ts'));
  assert.ok(!files.some((f) => f.startsWith('features/orders/components/')));
  assert.ok(files.includes('features/billing/pages/InvoicesPage.tsx'));
  assert.ok(!importableFiles(dir, { library: 'library', features: 'features' }, 'library/pages/ListPage.tsx').includes('features/orders/index.ts'));
});
