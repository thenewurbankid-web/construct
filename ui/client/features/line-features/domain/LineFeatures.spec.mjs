import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { featureCards } from './FeatureCards.ts';
import { itemGroups, specView } from './ItemGroups.ts';
import { itemBase, itemLink } from './ItemRows.ts';

const ops = () => createMockLineOps();

test('featureCards: each feature says "All fine" or "Needs attention" with a count in words', () => {
  assert.deepEqual(featureCards(ops().readLineProject('/mock')), [
    { name: 'billing', ok: false, status: 'Needs attention', text: 'One item, one needs attention.' },
    { name: 'orders', ok: true, status: 'All fine', text: '2 items, all fine.' },
  ]);
});

test('itemGroups: items by kind with their base and a link to the screen that edits them', () => {
  const groups = itemGroups(ops().readLineFeature('/mock', 'orders'));
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => `${r.name}: ${r.base.text}`)]), [
    ['Pages', ['OrdersPage: Based on ListPage']],
    ['Components', ['OrderButton: Based on Button']],
  ]);
  assert.deepEqual(groups[0].rows[0].link, { href: '/pages?feature=orders&page=orders%2Fpages%2FOrdersPage', label: 'Open OrdersPage in Pages' });
  assert.deepEqual(groups[1].rows[0].link, { href: '/components', label: 'Open OrderButton in Components' });
  assert.equal(itemLink({ kind: 'workflows', feature: 'a', id: 'a/workflows/x', name: 'x' }), null);
  assert.equal(itemBase({ base: { value: null, libraryId: null } }).ok, false);
  assert.match(itemBase({ base: { value: 'components/Nope', libraryId: null } }).text, /^Its base "components\/Nope" is not in the library/);
});

test('specView: says how much of the spec is covered; no spec.md gives null', () => {
  const view = specView(ops().readLineFeature('/mock', 'orders'));
  assert.equal(view.coverage, '1 of 2 acceptance points are covered.');
  assert.deepEqual(view.stories[0].points.map((p) => p.covered), [true, false]);
  assert.equal(specView({ spec: null }), null);
  assert.equal(specView({ spec: { file: 's.md', stories: [] } }).coverage, 'This spec has no acceptance points yet.');
});
