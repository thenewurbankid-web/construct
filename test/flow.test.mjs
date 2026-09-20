// #328 (core half): the flow section of `construct summarize <feature>`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { summarizeUnit, renderUnitMarkdown } from '../src/engine/unitSummary.mjs';
import { createContext } from '../src/engine/units/facts.mjs';
import { buildFlow } from '../src/engine/units/flow.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = (n) => path.join(REPO, 'fixtures', n);
const SPA = fx('flow-react-spa');
const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'schemas', 'unit-summary.v1.json'), 'utf8'));
const validateFlow = new Ajv({ allErrors: true, strict: false }).compile({ $ref: '#/definitions/flow', definitions: schema.definitions });
const flowOf = (root, ref, detail = 'standard') => {
  const r = summarizeUnit(root, ref, { detail, kind: 'feature' });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.sections.flow;
};
const flatten = (nodes = []) => nodes.flatMap((n) => [n, ...flatten(n.children)]);
const files = (nodes) => flatten(nodes).map((n) => n.file);

test('flow validates against the schema fragment (all fixtures, standard and full)', () => {
  for (const [root, feats] of [[SPA, ['billing', 'orders', 'shared', 'ui-kit']], [fx('impact-shared'), ['checkout', 'shared']], [path.join(REPO, 'example'), ['login', 'core']]]) {
    for (const f of feats) for (const detail of ['standard', 'full']) {
      const flow = flowOf(root, f, detail);
      assert.ok(validateFlow(flow), `${path.basename(root)}/${f}/${detail}: ${JSON.stringify(validateFlow.errors)}`);
    }
  }
});

test('the route is the root; a controller has behaviour and render branches drawn from the import graph', () => {
  const flow = flowOf(fx('impact-shared'), 'checkout');
  assert.equal(flow.routeAdapter, true);
  assert.equal(flow.routes.length, 1);
  const [route] = flow.routes;
  assert.equal(route.route, '/checkout');
  assert.equal(route.fanOut, false);
  const ctl = route.features[0].controllers[0];
  assert.equal(ctl.file, 'features/checkout/controllers/CheckoutController.tsx');
  // real import direction is hook -> workflow -> service -> domain (DEFAULT_LAYERS lists workflow/hook the other way round)
  const hook = ctl.behaviour.find((n) => n.layer === 'hook');
  assert.equal(hook.children[0].layer, 'workflow');
  assert.deepEqual(files(ctl.behaviour).sort(), [
    'features/checkout/domain/checkoutRules.ts', 'features/checkout/hooks/useCheckout.ts',
    'features/checkout/services/checkoutService.ts', 'features/checkout/workflows/CheckoutWorkflow.ts',
  ]);
  assert.ok(ctl.behaviour.every((n) => ['hook', 'workflow', 'service', 'domain'].includes(n.layer)));
  assert.ok(ctl.render.every((n) => ['page', 'component'].includes(n.layer)));
  assert.equal(ctl.render[0].layer, 'page');
});

test('types.ts and index.ts are left out of the flow; a shared component is reached through its feature barrel', () => {
  const flow = flowOf(fx('impact-shared'), 'billing');
  const all = files([...flow.routes[0].features[0].controllers[0].behaviour, ...flow.routes[0].features[0].controllers[0].render]);
  assert.ok(all.every((f) => !/(^|\/)(types|index)\.[a-z]+$/.test(f)), all.join(','));
  const shared = flatten(flow.routes[0].features[0].controllers[0].render).find((n) => n.file === 'features/shared/components/CurrencyLabel.tsx');
  assert.ok(shared, 'CurrencyLabel reached via features/shared/index.ts');
  assert.equal(shared.feature, 'shared');
});

test('fan-out: one route, two features, ordered by the route file import order; shared file drawn once', () => {
  const flow = flowOf(SPA, 'billing');
  const checkout = flow.routes.find((r) => r.route === '/checkout');
  assert.equal(checkout.fanOut, true);
  assert.deepEqual(checkout.features.map((f) => [f.feature, f.self]), [['orders', false], ['billing', true]]); // App.tsx imports orders first, not alphabetical
  const label = 'features/shared/components/CurrencyLabel.tsx';
  const under = (feat) => flatten([...checkout.features.find((f) => f.feature === feat).controllers[0].render]).find((n) => n.file === label);
  assert.equal(under('orders').shownAbove, undefined, 'first use is drawn in full');
  assert.equal(under('billing').shownAbove, true, 'second use under the same route is "shown above"');
  assert.equal(under('billing').children, undefined);
});

test('a controller reached by several routes repeats under each route; shared-once restarts per route', () => {
  const flow = flowOf(SPA, 'billing');
  assert.deepEqual(flow.routes.map((r) => r.route), ['/billing', '/billing/history', '/checkout']);
  for (const r of flow.routes.slice(0, 2)) {
    const ctl = r.features[0].controllers[0];
    assert.equal(ctl.file, 'features/billing/controllers/BillingController.tsx');
    const label = flatten(ctl.render).find((n) => n.file.endsWith('CurrencyLabel.tsx'));
    assert.equal(label.shownAbove, undefined, `${r.route} reads as a complete flow`);
  }
});

test('a feature no route reaches gets an info-level note, and it is not a warning', () => {
  const r = summarizeUnit(SPA, 'feature:ui-kit', { kind: 'feature' });
  assert.deepEqual(r.sections.flow.routes, []);
  assert.equal(r.sections.flow.routeAdapter, true);
  assert.deepEqual(r.sections.flow.notes.map((n) => [n.severity, n.code]), [['info', 'no-route']]);
  assert.match(r.sections.flow.notes[0].message, /No route reaches this feature/);
  assert.ok(r.health.findings.some((f) => f.code === 'no-route' && f.severity === 'info'));
  // the shared feature is reached only through other features' components, not by a route of its own
  assert.deepEqual(flowOf(SPA, 'shared').routes, []);
});

test('a framework with no route adapter shows NO routes (never a guess)', () => {
  const ctx = createContext(SPA);
  const flow = buildFlow(ctx, 'billing', { adapters: {} });
  assert.deepEqual(flow, {
    framework: 'react-spa', routeAdapter: false, routes: [],
    notes: [{ severity: 'info', code: 'no-route-adapter', message: 'No route adapter exists for framework "react-spa", so no routes are shown.' }],
  });
  assert.ok(validateFlow(flow));
});

test('nextjs example: login is reached by /login; nothing changes for existing sections', () => {
  const flow = flowOf(path.join(REPO, 'example'), 'login');
  assert.deepEqual(flow.routes.map((r) => [r.route, r.file]), [['/login', 'app/login/page.tsx']]);
  const r = summarizeUnit(path.join(REPO, 'example'), 'feature:login', { kind: 'feature' });
  assert.deepEqual(r.sections.contracts.routes, [{ route: '/login', file: 'app/login/page.tsx' }]);
});

test('brief carries no flow tree (its budget has no headroom); full adds purposes', () => {
  assert.equal(summarizeUnit(SPA, 'feature:billing', { detail: 'brief', kind: 'feature' }).sections.flow, undefined);
  const full = flowOf(SPA, 'billing', 'full');
  assert.equal(typeof full.routes[0].features[0].controllers[0].behaviour[0].purpose, 'string');
  assert.equal(flowOf(SPA, 'billing', 'standard').routes[0].features[0].controllers[0].behaviour[0].purpose, undefined);
});

test('determinism: byte-identical JSON and markdown across fresh calls', () => {
  for (const [root, f] of [[SPA, 'billing'], [SPA, 'orders'], [fx('impact-shared'), 'checkout'], [path.join(REPO, 'example'), 'login']]) {
    const a = summarizeUnit(root, `feature:${f}`);
    const b = summarizeUnit(root, `feature:${f}`);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(renderUnitMarkdown(a), renderUnitMarkdown(b));
  }
});

test('markdown renders the flow as an indented tree with "shown above"', () => {
  const md = renderUnitMarkdown(summarizeUnit(SPA, 'feature:billing', { kind: 'feature' }));
  assert.match(md, /## flow/);
  assert.match(md, /- route `\/checkout` \(src\/App\.tsx\) — fan-out: orders, billing/);
  assert.match(md, /^ {6}- hook: `features\/billing\/hooks\/useBilling\.ts`$/m);
  assert.match(md, /CurrencyLabel\.tsx` \(from shared\) _\(shown above\)_/);
  assert.match(renderUnitMarkdown(summarizeUnit(SPA, 'feature:ui-kit', { kind: 'feature' })), /info: No route reaches this feature/);
});
