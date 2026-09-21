import test from 'node:test';
import assert from 'node:assert/strict';
import { toListItems, findFeature, fileHref, buildFeatureView } from './FeatureView.ts';

const rows = [
  { name: 'billing', path: 'features/billing', ref: 'feature:billing', summary: 'Feature "billing": 9 files, 66 LOC, 7/7 layers; 1 workflow machine(s).', health: 'ok' },
  { name: 'cart', path: 'features/cart', ref: 'feature:cart', summary: 'Feature "cart": 2 files.', health: 'ok' },
];

test('list rows: the name, and the engine\'s own one-line summary without the repeated name', () => {
  assert.deepEqual(toListItems(rows)[0], { id: 'billing', label: 'billing', detail: '9 files, 66 LOC, 7/7 layers; 1 workflow machine(s).' });
  assert.equal(toListItems([{ name: 'x', path: 'features/x', ref: 'feature:x', error: { message: 'boom' } }])[0].detail, 'Could not be summarized: boom');
  assert.equal(findFeature(rows, 'cart').name, 'cart');
  assert.equal(findFeature(rows, 'nope'), null);
  assert.equal(findFeature(rows, null), null);
});

test('links: components open on Components, pages on Pages, the rest have no screen', () => {
  assert.equal(fileHref('billing', 'component', 'features/billing/components/BillingView.tsx'), '/components?component=features%2Fbilling%2Fcomponents%2FBillingView.tsx');
  assert.equal(fileHref('billing', 'page', 'features/billing/pages/BillingPage.tsx'), '/pages?feature=billing&file=BillingPage.tsx');
  assert.equal(fileHref('billing', 'page', 'src/features/billing/pages/sub/Deep.tsx'), '/pages?feature=billing&file=sub%2FDeep.tsx');
  assert.equal(fileHref('billing', 'hook', 'features/billing/hooks/useBilling.ts'), null);
  assert.equal(fileHref('a.b', 'page', 'features/aXb/pages/P.tsx'), null, 'the feature name is matched literally');
});

const summary = {
  ok: true,
  name: 'billing',
  path: 'features/billing',
  summary: 'Feature "billing": 9 files.',
  health: { status: 'ok', findings: [{ severity: 'info', code: 'no-tests', message: 'No test files found.' }, { severity: 'warning', code: 'x', message: 'A warning.' }] },
  sections: {
    layers: { present: ['domain', 'page', 'component', 'weird'], missing: ['hook'] },
    files: {
      domain: [{ path: 'features/billing/domain/r.ts', layer: 'domain', loc: 5, purpose: 'Rules.' }],
      page: [{ path: 'features/billing/pages/BillingPage.tsx', layer: 'page', loc: 8, purpose: 'Page.' }],
      component: [{ path: 'features/billing/components/BillingView.tsx', layer: 'component', loc: 13, purpose: 'View.' }],
      weird: [],
    },
    contracts: { routes: [{ route: '/billing', file: 'app/billing/page.tsx' }] },
    workflows: [{ file: 'features/billing/workflows/W.ts', machine: 'w', summary: 'A machine.', states: 3, findings: [] }],
    dependencies: { usedBy: [{ name: 'app/billing', files: 1 }], usesFeatures: [{ name: 'shared', files: 1 }] },
    rules: { counts: { error: 0, warning: 2 } },
    tests: { count: 1, files: ['features/billing/tests/a.spec.ts'] },
  },
};

test('details: layers in flow order, unknown layers last, links, routes, workflows, tests, rules', () => {
  const v = buildFeatureView(summary);
  assert.deepEqual(v.layers.map((l) => l.layer), ['page', 'component', 'domain', 'weird']);
  assert.equal(v.layers[0].files[0].href, '/pages?feature=billing&file=BillingPage.tsx');
  assert.match(v.layers[1].files[0].href, /^\/components\?component=/);
  assert.equal(v.layers[2].files[0].href, null);
  assert.deepEqual(v.missingLayers, ['hook']);
  assert.deepEqual(v.routes, [{ route: '/billing', file: 'app/billing/page.tsx' }]);
  assert.equal(v.workflows[0].machine, 'w');
  assert.deepEqual(v.tests, { count: 1, files: ['features/billing/tests/a.spec.ts'] });
  assert.deepEqual(v.rules, { error: 0, warning: 2 });
  assert.deepEqual(v.findings, ['A warning.'], 'info notes are not findings');
  assert.deepEqual(v.usedBy, ['app/billing']);
  assert.deepEqual(v.usesFeatures, ['shared']);
});

test('details: missing sections are empty, and an error answer is no view', () => {
  const v = buildFeatureView({ ok: true, name: 'x', path: 'features/x', summary: 's', health: { status: 'ok', findings: [] }, sections: {} });
  assert.deepEqual(v.layers, []);
  assert.deepEqual(v.tests, { count: 0, files: [] });
  assert.equal(buildFeatureView({ ok: false }), null);
});
