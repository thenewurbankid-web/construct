// #334: route discovery as a per-framework adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../src/engine/units/facts.mjs';
import { discoverRoutes, featureRoutes, readRouteTable, routeAdapterFor, ROUTE_ADAPTERS } from '../src/engine/units/route-adapters.mjs';
import { summarizeUnit } from '../src/engine/unitSummary.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import fs from 'node:fs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = (n) => path.join(REPO, 'fixtures', n);
const SPA = fx('flow-react-spa');

test('react-spa: routes come from the route layer file and resolve to controllers (import order kept)', () => {
  const routes = discoverRoutes(createContext(SPA));
  assert.deepEqual(routes.map((r) => [r.route, r.file, r.entries.map((e) => e.feature)]), [
    ['/billing', 'src/App.tsx', ['billing']],
    ['/billing/history', 'src/App.tsx', ['billing']],
    // one route rendering two features: fan-out, ordered by the route file's imports (orders before billing)
    ['/checkout', 'src/App.tsx', ['orders', 'billing']],
  ]);
});

test('react-spa: two routes for one feature, and a feature reports its routes', () => {
  const ctx = createContext(SPA);
  assert.deepEqual(featureRoutes(ctx, 'billing').map((r) => r.route), ['/billing', '/billing/history', '/checkout']);
  assert.deepEqual(featureRoutes(ctx, 'orders').map((r) => r.route), ['/checkout']);
  assert.deepEqual(featureRoutes(ctx, 'ui-kit'), []);
  const s = summarizeUnit(SPA, 'feature:orders');
  assert.deepEqual(s.sections.contracts.routes, [{ route: '/checkout', file: 'src/App.tsx' }]);
});

test('react-spa: `summarize route:` works and starts at the route\'s own controllers', () => {
  const r = summarizeUnit(SPA, 'route:/billing');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.sections.features, ['billing', 'shared']); // shared is reached through billing's component
  const both = summarizeUnit(SPA, 'route:/checkout');
  assert.deepEqual(both.sections.features, ['billing', 'orders', 'shared']);
});

test('nextjs: unchanged (page.tsx routes, same feature route lists)', () => {
  const ex = createContext(path.join(REPO, 'example'));
  assert.deepEqual(featureRoutes(ex, 'login'), [{ route: '/login', file: 'app/login/page.tsx' }]);
  assert.deepEqual(discoverRoutes(ex).map((r) => r.route), ['/', '/login', '/signup']);
});

test('unknown framework: no adapter, so no routes (never a guess)', () => {
  const ctx = createContext(SPA);
  const none = {}; // an adapter table with no entry for this project's framework
  assert.equal(routeAdapterFor(ctx, none), null);
  assert.deepEqual(discoverRoutes(ctx, none), []);
  assert.deepEqual(featureRoutes(ctx, 'billing', none), []);
  assert.deepEqual(Object.keys(ROUTE_ADAPTERS).sort(), ['nextjs', 'react-spa']);
});

test('readRouteTable: nested <Route>, index routes, Component=, wrapper tags', () => {
  const t = readRouteTable(`
    const X = () => (
      <Routes>
        <Route path="/app" element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="users/:id" element={<Guard><UserController /></Guard>} />
        </Route>
        <Route path="/lazy" Component={LazyThing} />
      </Routes>
    );`);
  assert.deepEqual(t, [
    { route: '/app', tags: ['Shell'] },
    { route: '/app', tags: ['Home'] },
    { route: '/app/users/:id', tags: ['Guard', 'UserController'] },
    { route: '/lazy', tags: ['LazyThing'] },
  ]);
});

test('readRouteTable: createBrowserRouter object tables, with children', () => {
  const t = readRouteTable(`
    export const router = createBrowserRouter([
      { path: '/', element: <Layout />, children: [
        { index: true, element: <HomeController /> },
        { path: 'settings', element: <SettingsController /> },
      ] },
      { path: '/login', Component: LoginController },
    ]);`);
  assert.deepEqual(t, [
    { route: '/', tags: ['Layout'] },
    { route: '/', tags: ['HomeController'] },
    { route: '/settings', tags: ['SettingsController'] },
    { route: '/login', tags: ['LoginController'] },
  ]);
});

test('react-spa: lazy() elements and feature barrels resolve to the controller', () => {
  const dir = makeTempDir('route-adapter-lazy');
  fs.cpSync(SPA, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/App.tsx'), `import { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { OrdersController } from '../features/orders';
const BillingController = lazy(() => import('../features/billing/controllers/BillingController'));
export const App = () => (<Routes><Route path="/o" element={<OrdersController />} /><Route path="/b" element={<BillingController />} /></Routes>);
`);
  const routes = discoverRoutes(createContext(dir));
  assert.deepEqual(routes.map((r) => [r.route, r.entries.map((e) => e.feature)]), [['/b', ['billing']], ['/o', ['orders']]]);
});
