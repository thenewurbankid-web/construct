import test from 'node:test';
import assert from 'node:assert/strict';
import { toListItems, findFeature, fileHref, buildFeatureView, legacyNote, apiFileFor } from './FeatureView.ts';

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

test('details: layers in LIN-150\'s canonical order (packages/core LAYER_ORDER), unknown layers last, links, routes, workflows, tests, rules', () => {
  const v = buildFeatureView(summary);
  assert.deepEqual(v.layers.map((l) => l.layer), ['domain', 'component', 'page', 'weird']);
  assert.equal(v.layers[0].files[0].href, null);
  assert.match(v.layers[1].files[0].href, /^\/components\?component=/);
  assert.equal(v.layers[2].files[0].href, '/pages?feature=billing&file=BillingPage.tsx');
  assert.deepEqual(v.missingLayers, ['hook']);
  assert.deepEqual(v.routes, [{ route: '/billing', file: 'app/billing/page.tsx' }]);
  assert.equal(v.workflows[0].machine, 'w');
  assert.deepEqual(v.tests, { count: 1, files: ['features/billing/tests/a.spec.ts'] });
  assert.deepEqual(v.rules, { error: 0, warning: 2 });
  assert.deepEqual(v.findings, ['A warning.'], 'info notes are not findings');
  assert.deepEqual(v.usedBy, ['app/billing']);
  assert.deepEqual(v.usesFeatures, ['shared']);
  assert.equal(v.root, 'features', 'the default root, derived from path');
});

test('root: derived from path, so a project with features.root: construct shows it', () => {
  const custom = { ...summary, path: 'construct/billing' };
  assert.equal(buildFeatureView(custom).root, 'construct');
});

test('layer violations: grouped by the layer that owns the file, one dot\'s worth per layer (#803)', () => {
  const withViolations = {
    ...summary,
    sections: {
      ...summary.sections,
      rules: {
        counts: { error: 0, warning: 2 },
        violations: [
          { rule: 'COMPONENT-005', severity: 'warning', file: 'features/billing/components/BillingView.tsx', message: 'Inline conditional.' },
          { rule: 'PAGE-002', severity: 'warning', file: 'features/billing/pages/BillingPage.tsx', message: 'Missing loading state.' },
          { rule: 'DOMAIN-002', severity: 'error', file: 'features/other/domain/x.ts', message: 'Outside this feature -- never attributed here.' },
        ],
      },
    },
  };
  const v = buildFeatureView(withViolations);
  const byLayer = Object.fromEntries(v.layers.map((l) => [l.layer, l.violations]));
  assert.deepEqual(byLayer.component.map((x) => x.rule), ['COMPONENT-005']);
  assert.deepEqual(byLayer.page.map((x) => x.rule), ['PAGE-002']);
  assert.deepEqual(byLayer.domain, [], 'a layer with no violations gets an empty array, not undefined');
  assert.deepEqual(byLayer.weird, []);
});

test('layer violations: absent sections.rules.violations is every layer with an empty list', () => {
  const v = buildFeatureView(summary);
  for (const l of v.layers) assert.deepEqual(l.violations, []);
});

test('legacyNote: only a non-default root with files to report gets the note (#791)', () => {
  assert.equal(legacyNote('features', { count: 7 }), null, 'default root: never shown');
  assert.equal(legacyNote('construct', { count: 0 }), null, 'nothing outside the root: never shown');
  assert.equal(legacyNote(undefined, { count: 7 }), null, 'no root known yet');
  assert.equal(legacyNote('construct', undefined), null, 'no legacy data yet');
  assert.equal(legacyNote('construct', { count: 38 }), 'Legacy, outside construct/ (38 files, not managed)');
  assert.equal(legacyNote('construct', { count: 1 }), 'Legacy, outside construct/ (1 file, not managed)');
});

test('details: a layer with files shows even if layers.present doesn\'t list it yet (LIN-150: packages/engine\'s own CORE_LAYERS copy hasn\'t learned viewmodel/adapter)', () => {
  const withViewModel = {
    ...summary,
    sections: {
      ...summary.sections,
      layers: { present: ['domain', 'page', 'component'], missing: ['hook'] }, // engine's list omits viewmodel/adapter
      files: {
        ...summary.sections.files,
        viewmodel: [{ path: 'features/billing/viewmodels/ChargeViewModel.ts', layer: 'viewmodel', loc: 5, purpose: 'VM.' }],
        adapter: [{ path: 'features/billing/adapters/ChargeAdapter.ts', layer: 'adapter', loc: 4, purpose: 'Adapter.' }],
      },
    },
  };
  const v = buildFeatureView(withViewModel);
  assert.deepEqual(v.layers.map((l) => l.layer), ['domain', 'component', 'adapter', 'page', 'viewmodel', 'weird']);
});

test('apiFileFor: a ViewModel file\'s Adapter is found by deterministic naming alone (LIN-150), no file read', () => {
  const layers = [
    { layer: 'adapter', files: [{ path: 'features/billing/adapters/ChargeAdapter.ts', purpose: 'Adapter.', loc: 1, href: null }], violations: [] },
    { layer: 'viewmodel', files: [], violations: [] },
  ];
  const vm = { path: 'features/billing/viewmodels/ChargeViewModel.ts', purpose: 'ViewModel.', loc: 1, href: null };
  assert.equal(apiFileFor(vm, layers)?.path, 'features/billing/adapters/ChargeAdapter.ts');
  assert.equal(apiFileFor({ ...vm, path: 'features/billing/viewmodels/OtherViewModel.ts' }, layers), null, 'no matching adapter: null, not a guess');
  assert.equal(apiFileFor({ ...vm, path: 'features/billing/pages/ChargePage.tsx' }, layers), null, 'not a ViewModel file at all');
  assert.equal(apiFileFor(vm, []), null, 'no adapter layer present');
});

test('details: missing sections are empty, and an error answer is no view', () => {
  const v = buildFeatureView({ ok: true, name: 'x', path: 'features/x', summary: 's', health: { status: 'ok', findings: [] }, sections: {} });
  assert.deepEqual(v.layers, []);
  assert.deepEqual(v.tests, { count: 0, files: [] });
  assert.equal(buildFeatureView({ ok: false }), null);
});
