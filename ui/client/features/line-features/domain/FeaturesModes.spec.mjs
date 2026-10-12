import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { crumbTarget, crumbsOf, optionsAt, placeFromSearch, providerProblems } from '../../../lib/lineModes.ts';
import { featuresAnswer, featuresOptions } from './FeaturesModes.ts';
import { FEATURES_MODES as P } from './FeaturesProvider.ts';
import { featuresPlace } from './FeaturesPlace.ts';
import { pageValues } from './PageValues.ts';

const project = () => createMockLineOps().readLineProject('/mock');
const data = (parts = ['title']) => ({ project: project(), parts });

test('Features modes: the provider passes the contract at every level (feature, item, part) and opens in chat', () => {
  assert.equal(P.defaultMode, 'chat');
  assert.deepEqual(P.params, ['feature', 'item', 'part']);
  for (const place of [featuresPlace(null, null, null), featuresPlace('orders', null, null), featuresPlace('orders', 'OrdersPage', null), featuresPlace('orders', 'OrdersPage', 'title')]) {
    assert.deepEqual(providerProblems(P, place, data()), [], JSON.stringify(place.steps));
  }
});

test('Features modes: cd1\'s options stay, with Open an item before All features; an item offers its parts and Explain', () => {
  assert.deepEqual(featuresOptions(featuresPlace(null, null, null), null).map((o) => o.id), ['features.open', 'features.missing', 'features.create', 'features.import', 'features.explain']);
  assert.deepEqual(featuresOptions(featuresPlace('orders', null, null), null).map((o) => o.id), ['feature.missing', 'feature.explain', 'feature.add', 'feature.fix', 'feature.items', 'feature.back']);
  assert.deepEqual(optionsAt(P, featuresPlace('orders', 'OrdersPage', null), data()).map((o) => o.id), ['feature.parts', 'feature.item-explain', 'features.up']);
  assert.equal(optionsAt(P, featuresPlace('orders', 'OrdersPage', null), data()).at(-1).label, 'Back to orders');
  assert.equal(featuresOptions(featuresPlace('orders', 'OrderButton', null), data()).find((o) => o.id === 'feature.parts').disabled, 'Only a page has parts you can open here.');
  assert.equal(featuresOptions(featuresPlace('orders', 'OrdersPage', null), data([])).find((o) => o.id === 'feature.parts').disabled, 'This page has no values you can change without code.');
});

test('Features modes: Open an item lists the feature\'s items and opens the item level; Open a part opens the part level', () => {
  const items = featuresAnswer('feature.items', featuresPlace('orders', null, null), data());
  assert.equal(items.opens, 'item');
  assert.ok(items.pick.items.some((i) => i.id === 'OrdersPage'));
  const parts = featuresAnswer('feature.parts', featuresPlace('orders', 'OrdersPage', null), data(['title']));
  assert.equal(parts.opens, 'part');
  assert.deepEqual(parts.pick.items.map((i) => i.id), ['title']);
  assert.match(featuresAnswer('feature.item-explain', featuresPlace('orders', 'OrdersPage', null), data()).text, /^OrdersPage is a page of orders\. It is based on /);
  assert.equal(featuresAnswer('features.missing', featuresPlace(null, null, null), data()), null, 'cd1 answers its own options');
});

test('Features modes: the breadcrumb is "Features › orders › OrdersPage › title"; the orders crumb is Under the hood with orders open', () => {
  const crumbs = crumbsOf(P, featuresPlace('orders', 'OrdersPage', 'title'));
  assert.deepEqual(crumbs.map((c) => c.label), ['Features', 'orders', 'OrdersPage', 'title']);
  const orders = crumbTarget(crumbs[1]);
  assert.deepEqual([orders.mode, orders.href], ['hood', '/?feature=orders']);
  assert.deepEqual(orders.place.steps.map((s) => [s.param, s.id]), [['feature', 'orders']]);
  assert.equal(crumbTarget(crumbs[2]).href, '/?feature=orders&item=OrdersPage');
  assert.equal(crumbTarget(crumbs[3]).href, '/?feature=orders&item=OrdersPage&part=title');
  assert.deepEqual(placeFromSearch(P, '?feature=orders&item=OrdersPage', data()).steps.map((s) => s.id), ['orders', 'OrdersPage']);
  assert.deepEqual(placeFromSearch(P, '?feature=orders&part=title', data()).steps.map((s) => s.id), ['orders'], 'a part without its item is no place');
});

test('Features modes: a page\'s parts are its plain values a person can change without code, each once', () => {
  const node = (props, children = [], settable = true) => ({ id: 'n', tag: 'X', isFragment: false, isCustomComponent: true, props, settable, line: 1, column: 1, children });
  const tree = { file: 'f', feature: 'orders', contentHash: 'h', scopeNames: [], roots: [node([{ kind: 'string', name: 'title', value: 'Orders' }, { kind: 'expression', name: 'onMore', value: '() => {}' }], [node([{ kind: 'string', name: 'title', value: 'x' }, { kind: 'boolean', name: 'dense', value: true }])])] };
  assert.deepEqual(pageValues(tree), ['title', 'dense']);
});
