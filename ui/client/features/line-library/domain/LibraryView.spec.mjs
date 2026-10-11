import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLibraryView, screenFor } from './LibraryView.ts';
import { libraryGroups, usedByText } from './LibraryGroups.ts';
import { baseText, featureSections } from './FeatureSections.ts';
import { initialLineProject, lineProjectReducer } from '../workflows/LineProject.ts';
import { createMockLineApi, mockLineProject } from '../services/LineApi.mock.ts';

const lib = (name, level, usedBy = 0, kind = 'components') => ({
  id: `${kind}/${name}`, kind, name, file: `library/${kind}/${name}.tsx`, ...(kind === 'components' ? { level } : {}),
  usedBy: Array.from({ length: usedBy }, (_, i) => ({ feature: 'f', file: `features/f/components/X${i}.tsx` })),
});
const project = (library, features = []) => ({ isLine: true, layout: { library: 'library', features: 'features', state: 'line' }, library, features, findings: [] });

test('groups: the contract mock\'s library components land in Atoms then Molecules, with base counts; pages are not cards', () => {
  const groups = libraryGroups(mockLineProject());
  assert.deepEqual(groups.map((g) => [g.title, g.cards.map((c) => `${c.name}:${c.usedByCount}`)]), [
    ['Atoms', ['Button:1', 'TextField:0']],
    ['Molecules', ['Dialog:0']],
  ]);
  assert.equal(groups[0].cards[0].usedByText, 'Used by 1 feature component');
  assert.equal(groups[0].cards[0].levelLabel, 'Atom');
});

test('groups: always Atoms, Molecules, Organisms order, names sorted, empty groups dropped, no level counts as atom', () => {
  const groups = libraryGroups(project([lib('Zed', 'organism'), lib('Card', 'molecule', 3), lib('Alpha', 'organism'), lib('Bare', undefined), lib('ListPage', undefined, 2, 'pages')]));
  assert.deepEqual(groups.map((g) => [g.level, g.cards.map((c) => c.name)]), [['atom', ['Bare']], ['molecule', ['Card']], ['organism', ['Alpha', 'Zed']]]);
  assert.equal(groups[1].cards[0].usedByText, 'Used by 3 feature components');
  assert.deepEqual(libraryGroups(project([])), []);
});

test('usedByText and baseText read as plain English', () => {
  assert.equal(usedByText(0), 'Not used by any feature yet');
  assert.equal(usedByText(2), 'Used by 2 feature components');
  const names = (id) => ({ 'components/Button': 'Button' })[id];
  assert.equal(baseText({ value: 'components/Button', libraryId: 'components/Button' }, names), 'Based on Button');
  assert.equal(baseText({ value: 'components/Nope', libraryId: null }, names), 'Based on components/Nope, which is not in the library');
  assert.equal(baseText({ value: null, libraryId: null }, names), 'No library base yet');
});

test('feature sections: only components, under their feature, with base link and problem state', () => {
  const p = project([lib('Button', 'atom', 1)], [
    { name: 'orders', spec: null, items: [
      { id: 'orders/components/OrderButton', kind: 'components', name: 'OrderButton', feature: 'orders', file: 'features/orders/components/OrderButton.tsx', base: { value: 'components/Button', libraryId: 'components/Button' }, status: 'ok', findings: [] },
      { id: 'orders/pages/OrdersPage', kind: 'pages', name: 'OrdersPage', feature: 'orders', file: 'features/orders/pages/OrdersPage.tsx', base: { value: null, libraryId: null }, status: 'ok', findings: [] },
    ] },
    { name: 'billing', spec: null, items: [
      { id: 'billing/components/InvoiceCard', kind: 'components', name: 'InvoiceCard', feature: 'billing', file: 'features/billing/components/InvoiceCard.tsx', base: { value: null, libraryId: null }, status: 'problem', findings: [{ sentence: 'No base.', rule: 'LINE-BASE', severity: 'error', file: 'features/billing/components/InvoiceCard.tsx', line: 1 }] },
    ] },
    { name: 'empty', spec: null, items: [] },
  ]);
  const sections = featureSections(p);
  assert.deepEqual(sections.map((s) => [s.name, s.rows.map((r) => `${r.name}|${r.baseText}|${r.linked}|${r.problem}`)]), [
    ['billing', ['InvoiceCard|No library base yet|false|true']],
    ['orders', ['OrderButton|Based on Button|true|false']],
  ]);
});

test('screen: loading, then the Line library for a Line project; a non-Line project or a failed read keeps today\'s screen', () => {
  let s = lineProjectReducer(initialLineProject, { type: 'LOAD' });
  assert.deepEqual(screenFor(s), { kind: 'loading' });
  s = lineProjectReducer(s, { type: 'LOADED', project: mockLineProject() });
  assert.equal(screenFor(s).kind, 'line');
  assert.equal(screenFor(s).view.total, 3);
  assert.deepEqual(screenFor(lineProjectReducer(s, { type: 'LOADED', project: { ...mockLineProject(), isLine: false } })), { kind: 'fallback' });
  assert.deepEqual(screenFor(lineProjectReducer(s, { type: 'FAILED', sentence: 'No.' })), { kind: 'fallback' });
});

test('view: total counts library component cards; the mock API answers the same project, or a refusal sentence', async () => {
  const view = buildLibraryView(mockLineProject());
  assert.equal(view.total, 3);
  assert.deepEqual(view.features.map((f) => f.name), ['orders']);
  const ok = await createMockLineApi().getLineProject();
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.project, mockLineProject());
  assert.deepEqual(await createMockLineApi({ fail: 'No project is open.' }).getLineProject(), { ok: false, sentence: 'No project is open.' });
});
