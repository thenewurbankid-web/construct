import test from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_SMART_VIEW } from '../../../../../packages/engine/line/knows/mock.mjs';
import { metricCard, smartTab, trendText } from './SmartCards.ts';

const metric = (o) => ({ id: 'coverage.tested', group: 'coverage', label: 'Logic units with a test', value: 0.5, count: 2, trend: [0.25, 0.5], improve: 'Add a test.', items: ['unit:a'], open: 'map', details: [], ...o });

test('a share reads as a percentage with its count; a count as a number; no data as its one sentence', () => {
  assert.equal(metricCard(metric({})).display, '50% of 2');
  assert.equal(metricCard(metric({ id: 'health.noBase', group: 'health', value: null, count: 3 })).display, '3');
  const empty = metricCard(metric({ value: null, count: undefined, trend: [], empty: 'Line found no logic units in this project yet.' }));
  assert.equal(empty.display, 'No data yet');
  assert.equal(empty.empty, 'Line found no logic units in this project yet.');
});

test('the trend in words: earlier to now, and which way it went (fewer problems is better for a health count)', () => {
  assert.deepEqual(trendText(metric({ trend: [0.25, 0.5] })), { text: '25% → 50%', direction: 'up' });
  assert.deepEqual(trendText(metric({ id: 'health.crossFeature', group: 'health', value: null, count: 1, trend: [2, 1] })), { text: '2 → 1', direction: 'up' });
  assert.deepEqual(trendText(metric({ trend: [0.5] })), { text: 'First measurement', direction: 'none' });
  assert.deepEqual(trendText(metric({ trend: [0.5, 0.5] })), { text: '50% → 50%', direction: 'flat' });
  assert.deepEqual(trendText(metric({ id: 'ai.refused', group: 'ai', trend: [0.1, 0.2] })).direction, 'down', 'more refusals is worse');
  assert.deepEqual(trendText(metric({ trend: [] })), { text: 'No trend yet', direction: 'none' });
});

test('#856 a card lists each Map item by its label with the hash as secondary text; no label: the hash alone', () => {
  const c = metricCard(metric({ items: ['unit:6fad22416fa70dad', 'unit:28f4fe2e81302a5a'], itemLabels: { 'unit:6fad22416fa70dad': 'handler in onMore, OrdersPage.tsx:6' } }));
  assert.deepEqual(c.itemRows, [
    { id: 'unit:6fad22416fa70dad', label: 'handler in onMore, OrdersPage.tsx:6', secondary: '6fad22416fa70dad' },
    { id: 'unit:28f4fe2e81302a5a', label: '28f4fe2e81302a5a' },
  ]);
  const item = metricCard(metric({ id: 'health.noBase', group: 'health', items: ['item:billing/components/InvoiceCard'], itemLabels: { 'item:billing/components/InvoiceCard': 'InvoiceCard' } }));
  assert.deepEqual(item.itemRows, [{ id: 'item:billing/components/InvoiceCard', label: 'InvoiceCard' }], 'no secondary text when it would repeat the label');
  assert.equal(metricCard(metric({ open: 'plan', items: ['m-1'] })).itemRows.length, 0, 'plan items are not Map rows');
  const mock = smartTab(MOCK_SMART_VIEW).groups.flatMap((g) => g.cards).find((x) => x.id === 'coverage.tested');
  assert.equal(mock.itemRows[0].label, 'handler in ListPage, ListPage.tsx:7');
});

test('the tab: five groups in order, every number of the mock, the sentence that nothing leaves the machine', () => {
  const t = smartTab(MOCK_SMART_VIEW);
  assert.deepEqual(t.groups.map((g) => g.label), ['Logic coverage', 'Graph health', 'AI accuracy', 'Fixes', 'Memory effect']);
  assert.equal(t.groups.flatMap((g) => g.cards).length, 13);
  assert.match(t.sentence, /nothing leaves it/);
});
