import test from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_KNOWS_GRAPH, graphRead } from '../../../../../packages/engine/line/knows/mock.mjs';
import { neighbourSentences, focusText } from './MapSentences.ts';
import { startItems, layerFilters, toggleLayer, itemRefs, refsSentence, ALL_LAYERS } from './MapItems.ts';
import { mapPicture } from './MapLayout.ts';

const g = MOCK_KNOWS_GRAPH;
const texts = (id, layers = ALL_LAYERS) => neighbourSentences(g, id, layers).map((s) => s.text);

test('a feature reads as its items\' bases and the rule its items break', () => {
  const t = texts('feature:orders');
  assert.ok(t.includes('OrdersPage is based on ListPage.'), t.join('\n'));
  assert.ok(t.includes('OrderButton is based on Button.'));
  assert.ok(t.includes('InvoicesPage uses OrderButton from feature orders, which a feature may not do.'));
  // A rule break comes first.
  assert.equal(neighbourSentences(g, 'feature:orders', ALL_LAYERS)[0].bad, true);
});

test('an import and a render of the same item are one sentence, with both edges under Details', () => {
  const s = neighbourSentences(g, 'item:orders/pages/OrdersPage', ['structure', 'static']);
  const uses = s.filter((x) => x.text === 'OrdersPage uses ListPage from the library.');
  assert.equal(uses.length, 1);
  assert.equal(uses[0].details.length, 2);
  assert.match(uses[0].details[0], /features\/orders\/pages\/OrdersPage\.tsx:\d+/);
});

test('the layer filter hides the sentences of a layer that is off; one layer always stays on', () => {
  assert.ok(texts('item:orders/pages/OrdersPage', ['structure']).includes('OrdersPage is based on ListPage.'));
  assert.ok(!texts('item:orders/pages/OrdersPage', ['structure']).some((x) => /when the tests ran/.test(x)));
  assert.ok(texts('item:orders/pages/OrdersPage', ['runtime']).includes('OrdersPage used ListPage when the tests ran.'));
  assert.deepEqual(toggleLayer(['structure'], 'structure'), ['structure']);
  assert.deepEqual(toggleLayer(['structure'], 'runtime'), ['structure', 'runtime']);
  const f = layerFilters(g, ['structure']);
  assert.deepEqual(f.map((x) => [x.layer, x.on]), [['structure', true], ['static', false], ['domain', false], ['runtime', false], ['process', false]]);
  assert.equal(f.find((x) => x.layer === 'runtime').count, 1);
});

test('start points: features first, then pages and components, then the library', () => {
  const s = startItems(g);
  assert.deepEqual(s.slice(0, 2).map((x) => x.name), ['billing', 'orders']);
  assert.equal(s.find((x) => x.name === 'OrdersPage').group, 'page');
  assert.equal(s.find((x) => x.name === 'OrderButton').text, 'component of orders');
  assert.equal(s.at(-1).group, 'library');
  assert.equal(focusText(g, 'item:orders/components/OrderButton'), 'A component of feature orders.');
});

test('who uses this and what breaks come from whoCalls / impactOf, as named items', () => {
  const r = graphRead(g, 'item:orders/components/OrderButton');
  const who = itemRefs(g, r.focus.whoCalls);
  assert.deepEqual(who.map((x) => x.name), ['InvoicesPage']);
  const breaks = itemRefs(g, r.focus.impactOf);
  assert.deepEqual(breaks.map((x) => x.name), ['InvoicesPage', '/billing', breaks[2].name]);
  assert.equal(breaks[2].text, 'a problem Line found');
  assert.equal(refsSentence('breaks', 'OrderButton', breaks), 'Changing OrderButton may affect 3 things, 1 of them item.');
  assert.equal(refsSentence('whoUses', 'Button', []), 'Nothing uses Button.');
});

test('the picture: dagre places the item and its neighbours left to right, the cross-feature link marked', () => {
  const p = mapPicture(g, 'item:orders/components/OrderButton', ALL_LAYERS);
  assert.deepEqual(p.nodes.map((n) => n.label).sort(), ['Button', 'InvoicesPage', 'OrderButton']);
  assert.ok(p.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  assert.ok(p.width > 0 && p.height > 0);
  const bad = p.edges.filter((e) => e.bad);
  assert.deepEqual(bad.map((e) => `${e.from}>${e.to}`), ['item:billing/pages/InvoicesPage>item:orders/components/OrderButton']);
  assert.equal(p.nodes.find((n) => n.focus).label, 'OrderButton');
  // Same graph, same picture.
  assert.deepEqual(mapPicture(g, 'item:orders/components/OrderButton', ALL_LAYERS), p);
  assert.deepEqual(mapPicture(g, 'item:nope', ALL_LAYERS).nodes, []);
});
