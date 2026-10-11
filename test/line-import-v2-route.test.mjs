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
import { assertRouteClosure } from '../packages/engine/line/importV2/shapes.mjs';
import { scanImport, planImport, importGraph } from '../packages/engine/line/import.mjs';
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
    'src/components/OrdersView.tsx', 'src/hooks/useOrders.ts', 'src/types/order.ts', 'src/utils/money.ts',
  ]);
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
  // The old wizard keeps its own default list; Import v2 has none.
  assert.deepEqual(traceExcludesFor({}), []);
  assert.deepEqual(traceExcludesFor({ configured: ['/x/'] }), ['/x/']);
  assert.deepEqual(traceExcludesFor({ excludes: [], configured: ['/x/'] }), []);
  const { aliases } = readPathAliases(app);
  const stops = [];
  traceRouteFiles(path.join(app, 'src/app/[locale]/orders/page.tsx'), { aliases, excludes: DEFAULT_TRACE_EXCLUDES, onStop: (what, why) => stops.push(why) });
  assert.ok(stops.includes('package'));
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
