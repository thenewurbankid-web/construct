// Line Import v2, route-seeded import (iv2-fit, packages/engine/line/importV2/route.mjs) on a temp copy of
// examples/import-v2-shop: a route and its sub-routes are one family, traced to one closure that becomes ONE feature;
// the trace stops only where the project or the caller says; scanImport and planImport take {route} beside {folder}.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { readRouteFamily, listRoutes, inFamily, familyFeature, commonFolder } from '../packages/engine/line/importV2/route.mjs';
import { assertRouteClosure } from '../packages/engine/line/importV2/contract.mjs';
import { scanImport, planImport, applyImport, importGraph } from '../packages/engine/line/import.mjs';
import { assertImportScan, assertImportPlan } from '../packages/engine/line/contract.mjs';
import { DEFAULT_TRACE_EXCLUDES, traceExcludesFor, traceRouteFiles, readPathAliases } from '../packages/core/route-resolver.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOP = path.join(REPO, 'examples/import-v2-shop');
const copy = () => { const dir = makeTempDir('construct-iv2-route-'); fs.cpSync(SHOP, dir, { recursive: true }); return dir; };

test('route family: /orders is the route and its sub-routes, traced to one closure, and becomes the feature orders', () => {
  const app = copy();
  assert.deepEqual(listRoutes(app).map((r) => r.route), ['/:locale/home', '/:locale/orders', '/:locale/orders/detail']);
  const c = readRouteFamily(app, '/orders');
  assertRouteClosure(c);
  assert.deepEqual(c.routes.map((r) => r.route), ['/:locale/orders', '/:locale/orders/detail'], 'the sub-route belongs to the family; /home does not');
  assert.deepEqual(c.files, [
    'src/app/[locale]/orders/OrdersClient.tsx', 'src/app/[locale]/orders/detail/page.tsx', 'src/app/[locale]/orders/page.tsx',
    'src/components/OrdersView.tsx', 'src/hooks/useOrders.ts',
  ]);
  assert.deepEqual(c.shared, ['src/types/order.ts', 'src/utils/money.ts'], '/home uses money (and the order type through it): shared, not the feature\'s');
  assert.ok(c.external.includes('react') && c.external.includes('next'), 'packages are boundaries the trace stopped at');
  assert.equal(familyFeature('/orders'), 'orders');
  assert.equal(familyFeature('/:locale/order-history/x'), 'order-history');
  assert.equal(commonFolder(c.files), 'src');
  assert.ok(inFamily('/orders', '/:locale/orders/detail') && !inFamily('/orders', '/:locale/ordersx'));
});

test('route family: the trace stops where the caller or architecture.yml (line.traceExcludes) says, and nowhere by default', () => {
  const app = copy();
  const byCaller = readRouteFamily(app, '/orders', { excludes: ['/hooks/'] });
  assert.ok(!byCaller.files.includes('src/hooks/useOrders.ts'));
  assert.ok(byCaller.external.includes('src/hooks/useOrders.ts'), 'the excluded file is listed as a boundary');
  fs.writeFileSync(path.join(app, 'architecture.yml'), 'version: 1\nline:\n  traceExcludes:\n    - /components/\n');
  const byConfig = readRouteFamily(app, '/orders');
  assert.ok(!byConfig.files.includes('src/components/OrdersView.tsx') && byConfig.files.includes('src/hooks/useOrders.ts'));
  assert.ok(!byConfig.shared.includes('src/components/OrdersView.tsx') && byConfig.external.includes('src/components/OrdersView.tsx'), 'an excluded file stays a boundary, not a shared file');
  // The old wizard keeps its own default list; Import v2 has none.
  assert.deepEqual(traceExcludesFor({}), []);
  assert.deepEqual(traceExcludesFor({ configured: ['/x/'] }), ['/x/']);
  assert.deepEqual(traceExcludesFor({ excludes: [], configured: ['/x/'] }), []);
  const { aliases } = readPathAliases(app);
  const stops = [];
  traceRouteFiles(path.join(app, 'src/app/[locale]/orders/page.tsx'), { aliases, excludes: DEFAULT_TRACE_EXCLUDES, onStop: (what, why) => stops.push(why) });
  assert.ok(stops.includes('package'));
});

/** The shop with a PriceTag component that both /home and /orders render. */
function withSharedComponent() {
  const app = copy();
  fs.writeFileSync(path.join(app, 'src/components/PriceTag.tsx'), 'export function PriceTag({ value }: { value: string }) {\n  return <span className="price">{value}</span>;\n}\n');
  const home = path.join(app, 'src/app/[locale]/home/page.tsx');
  fs.writeFileSync(home, `import { PriceTag } from '@/components/PriceTag';\n${fs.readFileSync(home, 'utf8').replace('<h1>Shop', '<h1><PriceTag value="Shop" />')}`);
  const view = path.join(app, 'src/components/OrdersView.tsx');
  fs.writeFileSync(view, `import { PriceTag } from './PriceTag';\n${fs.readFileSync(view, 'utf8').replace('<span>{total}</span>', '<PriceTag value={total} />')}`);
  return app;
}

test('route family scope: a component two routes share is in `shared`, not in `files`, and the import never moves it', () => {
  const app = withSharedComponent();
  const c = readRouteFamily(app, '/orders');
  assertRouteClosure(c);
  assert.ok(c.shared.includes('src/components/PriceTag.tsx'), 'PriceTag: /home renders it too');
  assert.ok(!c.files.includes('src/components/PriceTag.tsx'));
  assert.ok(c.files.includes('src/components/OrdersView.tsx'), 'OrdersView: only /orders uses it, so it is the feature\'s');
  // From the other side: /home keeps only its page; PriceTag is shared there too.
  const home = readRouteFamily(app, '/home');
  assert.deepEqual(home.files, ['src/app/[locale]/home/page.tsx']);
  assert.ok(home.shared.includes('src/components/PriceTag.tsx'));
  // A layout outside the family is a root too: what it imports is shared.
  const layout = path.join(app, 'src/app/[locale]/layout.tsx');
  fs.writeFileSync(layout, "import { OrdersView } from '@/components/OrdersView';\nexport { OrdersView };\nexport default function Layout({ children }: { children: unknown }) { return children; }\n");
  assert.ok(readRouteFamily(app, '/orders').shared.includes('src/components/OrdersView.tsx'), 'the locale layout imports OrdersView');
  fs.rmSync(layout);
  // Import: no plan step names PriceTag; after the import it is where it was, byte for byte.
  const before = fs.readFileSync(path.join(app, 'src/components/PriceTag.tsx'), 'utf8');
  const scan = scanImport(app, { route: '/orders' });
  assert.ok(!scan.found.some((f) => f.file.endsWith('PriceTag.tsx')), 'the scan does not read it as an item of the feature');
  const plan = planImport(app, { route: '/orders' });
  assert.ok(!JSON.stringify(plan.steps).includes('PriceTag.tsx'), 'no plan step moves the shared file');
  const r = applyImport(app, { route: '/orders' });
  assert.equal(r.ok, true, r.sentence);
  assert.equal(fs.readFileSync(path.join(app, 'src/components/PriceTag.tsx'), 'utf8'), before, 'the shared file stays where it is');
});

test('route family: several routes with no common prefix make ONE feature with the person\'s name; a single route works as before', () => {
  const app = withSharedComponent();
  const c = readRouteFamily(app, ['/home', '/orders'], { feature: 'shop' });
  assertRouteClosure(c);
  assert.equal(c.feature, 'shop');
  assert.deepEqual(c.routes.map((r) => r.route), ['/:locale/home', '/:locale/orders', '/:locale/orders/detail']);
  assert.ok(c.files.includes('src/components/PriceTag.tsx') && c.files.includes('src/utils/money.ts'), 'only the feature\'s own routes use them now');
  assert.deepEqual(c.shared, [], 'no route outside the feature reaches any of its files');
  assert.equal(readRouteFamily(app, '/orders').feature, 'orders', 'one route: the feature is named after it');
  assert.throws(() => readRouteFamily(app, ['/orders', '/billing']), (e) => e.code === 'UNKNOWN_ROUTE' && /no route \/billing/.test(e.sentence));
  assert.throws(() => readRouteFamily(app, ['/orders'], { feature: 'My Shop' }), (e) => e.code === 'BAD_FEATURE');
  const plan = planImport(app, { route: ['/home', '/orders'], feature: 'shop' });
  assertImportPlan(plan);
  assert.deepEqual(plan.steps[0].args.features, ['shop']);
  assert.match(plan.summary, /of the routes \/home and \/orders into Line/);
});

test('route family: an unknown route is refused in one sentence naming the routes there are', () => {
  const app = copy();
  assert.throws(() => readRouteFamily(app, '/billing'), (e) => e.name === 'LineOpError' && e.code === 'UNKNOWN_ROUTE' && /^The app has no route \/billing; its routes start with \/home, \/orders\.$/.test(e.sentence));
});

test('scanImport and planImport take {route}: only the family\'s files, every feature item in ONE feature named after the route', () => {
  const app = copy();
  const scan = scanImport(app, { route: '/orders' });
  assertImportScan(scan);
  assert.equal(scan.folder, 'src');
  assert.equal(/** @type {any} */ (scan).route, '/orders');
  const files = scan.found.map((f) => f.file);
  assert.ok(!files.some((f) => f.includes('/home/')), 'a page outside the family is not read');
  const features = new Set(scan.found.filter((f) => f.proposal.target === 'feature').map((f) => f.proposal.feature));
  assert.deepEqual([...features], ['orders'], 'one feature, not one per folder');
  const view = scan.found.find((f) => f.name === 'OrdersView');
  assert.equal(view.proposal.target, 'feature');
  const plan = planImport(app, { route: '/orders' });
  assertImportPlan(plan);
  assert.deepEqual(plan.steps[0].args.features, ['orders']);
  assert.match(plan.summary, /of the route \/orders into Line/);
  // A folder still works as before.
  assert.equal(scanImport(app, 'src').folder, 'src');
  assert.throws(() => scanImport(app, /** @type {any} */ ({})), /Name a folder or a route/);
});

test('importGraph is exported: who uses a file (reverse users), from the project\'s imports', () => {
  const app = copy();
  const g = importGraph(app, ['src/app/[locale]/home/page.tsx', 'src/app/[locale]/orders/detail/page.tsx', 'src/utils/money.ts']);
  assert.deepEqual([...(g.importers.get('src/utils/money.ts') ?? [])].sort(), ['src/app/[locale]/home/page.tsx', 'src/app/[locale]/orders/detail/page.tsx']);
});
