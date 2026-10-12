// "How smart is it" (knows/stats.mjs): numbers on the person's own project from local records only. The expected values
// below were worked out by hand from the fixtures before the code was written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computeSmart, itemLabeler, memoryReplay, smartView, readSmartInputs } from '../packages/engine/line/knows/stats.mjs';
import { assertSmartView, METRIC_IDS } from '../packages/engine/line/knows/contract.mjs';
import { MOCK_KNOWS_GRAPH } from '../packages/engine/line/knows/mock.mjs';
import { buildLineGraph } from '../packages/engine/line/graph/build.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const A = 'via-library:ui:I>F';
const B = 'base-on:ui:L>F';
let n = 0;
const rec = (step, intent, options, proposed, kind, chosen) => {
  n += 1;
  return { v: 1, id: `m-fix${String(n).padStart(4, '0')}`, step, at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(), intent, structure: null, slots: [], neighbourhood: [], options, proposed, kind, chosen, by: 'person', agreed: false };
};
// The drafter proposes B five times; the person picks A every time (memory learns it from the 4th on).
const MEMORY = [
  ...[1, 2, 3, 4, 5].map(() => rec('drafter.route', 'use.item', [A, B], B, 'picked', A)),
  rec('plan.step', 'promote.component', ['line.promote'], 'line.promote', 'approved', 'line.promote'),
  rec('plan.step', 'add.component', ['line.baseOn'], 'line.baseOn', 'refused', null),
  rec('plan.fix', 'fix.finding', ['LINE-DIR:promote', 'LINE-DIR:remove'], 'LINE-DIR:promote', 'fix-picked', 'LINE-DIR:promote'),
  rec('plan.fix', 'fix.finding', ['LINE-DIR:promote', 'LINE-DIR:remove'], 'LINE-DIR:promote', 'edited', 'LINE-DIR:remove'),
];
const INPUTS = {
  graph: MOCK_KNOWS_GRAPH,
  testedItems: ['item:library/pages/ListPage'],
  runtime: { reached: ['unit:6fad22416fa70dad'] },
  memory: MEMORY,
  decisions: { static: 3, ai: 1 },
  history: [{ at: '2026-10-10T00:00:00.000Z', values: { 'coverage.tested': 0.25, 'health.crossFeature': 2 } }],
};
const byId = (v) => Object.fromEntries(v.metrics.map((m) => [m.id, m]));

test('every number is present once, fits the contract, and says it comes from this machine only', () => {
  const v = computeSmart(INPUTS);
  assertSmartView(v);
  assert.deepEqual(v.metrics.map((m) => m.id), [...METRIC_IDS]);
  assert.equal(v.local, true);
  for (const m of v.metrics) assert.match(m.improve, /^[A-Z].*\.$/, m.id);
});

test('logic coverage: 1 of 2 units has a test (its item has one), 1 of 2 ran under the runtime recorder', () => {
  const m = byId(computeSmart(INPUTS));
  assert.deepEqual([m['coverage.tested'].value, m['coverage.tested'].count], [0.5, 2]);
  assert.deepEqual(m['coverage.tested'].items, ['unit:6fad22416fa70dad'], 'the items behind it are the units WITHOUT a test');
  assert.deepEqual([m['coverage.runtime'].value, m['coverage.runtime'].items], [0.5, ['unit:28f4fe2e81302a5a']]);
  assert.equal(m['coverage.tested'].open, 'map');
});

test('graph health: one cross-feature use, one item with no base, no unresolved import, no duplicate', () => {
  const m = byId(computeSmart(INPUTS));
  assert.deepEqual([m['health.crossFeature'].count, m['health.crossFeature'].items], [1, ['item:billing/pages/InvoicesPage']]);
  assert.deepEqual([m['health.noBase'].count, m['health.noBase'].items], [1, ['item:billing/components/InvoiceCard']]);
  assert.equal(m['health.unresolved'].count, 0);
  assert.equal(m['health.duplicates'].count, 0);
  for (const id of ['health.crossFeature', 'health.noBase']) assert.equal(m[id].value, null, 'a health number is a count');
  // A second OrderButton in billing is a duplicate of orders' (same name, two places).
  const dup = { ...MOCK_KNOWS_GRAPH, nodes: [...MOCK_KNOWS_GRAPH.nodes, { ...MOCK_KNOWS_GRAPH.nodes.find((x) => x.id === 'item:orders/components/OrderButton'), id: 'item:billing/components/OrderButton', file: 'features/billing/components/OrderButton.tsx', attrs: { area: 'feature', feature: 'billing', itemKind: 'components', layers: ['component'] } }] };
  const d = byId(computeSmart({ ...INPUTS, graph: dup }))['health.duplicates'];
  assert.deepEqual([d.count, d.items], [1, ['item:billing/components/OrderButton', 'item:orders/components/OrderButton']]);
});

test('AI accuracy: 2 of 9 accepted as they were, 6 edited, 1 refused; 3 of 4 decisions static; the drafter preferred route 0 of 5', () => {
  const m = byId(computeSmart(INPUTS));
  assert.equal(m['ai.accepted'].value, 0.222);
  assert.equal(m['ai.edited'].value, 0.667);
  assert.equal(m['ai.refused'].value, 0.111);
  assert.equal(m['ai.accepted'].count, 9);
  assert.equal(m['ai.staticShare'].value, 0.75);
  assert.deepEqual([m['ai.preferred'].value, m['ai.preferred'].count], [0, 5]);
  assert.ok(m['ai.accepted'].details.some((d) => /drafter\.route: 0 of 5 accepted/.test(d)), m['ai.accepted'].details.join('|'));
  assert.equal(m['ai.accepted'].open, 'plan');
});

test('fixes: 1 of 2 refusals fixed by the recommended typed fix with no edit by the person', () => {
  const m = byId(computeSmart(INPUTS));
  assert.deepEqual([m['fixes.typed'].value, m['fixes.typed'].count], [0.5, 2]);
});

test('memory effect: replaying the person\'s own picks, memory is right 2 of 5 times, the static order 0 of 5', () => {
  assert.deepEqual(memoryReplay(MEMORY), { with: 0.4, without: 0, cases: 5 });
  const m = byId(computeSmart(INPUTS))['memory.effect'];
  assert.equal(m.value, 0.4);
  assert.ok(m.details.includes('with memory 40%, without 0%, over 5 of your picks'), m.details.join('|'));
});

test('trends: earlier snapshots first, the current value last', () => {
  const m = byId(computeSmart(INPUTS));
  assert.deepEqual(m['coverage.tested'].trend, [0.25, 0.5]);
  assert.deepEqual(m['health.crossFeature'].trend, [2, 1]);
  assert.deepEqual(m['ai.staticShare'].trend, [0.75]);
});

test('no data: each number says so in one sentence, and nothing is made up', () => {
  const v = computeSmart({ graph: { ...MOCK_KNOWS_GRAPH, nodes: MOCK_KNOWS_GRAPH.nodes.filter((x) => x.kind !== 'unit') }, testedItems: [], runtime: null, memory: null, decisions: null, history: [] });
  assertSmartView(v);
  const m = byId(v);
  for (const id of ['coverage.tested', 'coverage.runtime', 'ai.accepted', 'ai.staticShare', 'ai.preferred', 'fixes.typed', 'memory.effect']) {
    assert.equal(m[id].value, null, id);
    assert.match(m[id].empty, /^[A-Z][^.]*\.$/, `${id} says why in one sentence`);
  }
  assert.equal(m['memory.effect'].empty, 'Line has no memory of your picks yet, so there is nothing to compare.');
});

test('on the real Line sample: local records only (no runtime run, no memory), the graph\'s health is real', () => {
  const root = fs.realpathSync(makeTempDir('line-smart-'));
  fs.cpSync(path.resolve('examples/line-sample'), root, { recursive: true });
  try {
    const graph = buildLineGraph(root, { write: false }).graph;
    const inputs = readSmartInputs(root, graph);
    assert.equal(inputs.runtime, null);
    assert.deepEqual(inputs.memory, []);
    const v = smartView(root, graph);
    assertSmartView(v);
    assert.equal(byId(v)['health.crossFeature'].count, 1);
    // The view keeps one snapshot, so the next read has a trend.
    const again = smartView(root, graph);
    assert.deepEqual(byId(again)['health.crossFeature'].trend, [1, 1]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#856 each logic unit behind a number has a readable label (its graph label plus file:line), hash as the fallback', () => {
  const m = byId(computeSmart(INPUTS));
  assert.deepEqual(m['coverage.tested'].itemLabels, { 'unit:6fad22416fa70dad': 'handler in OrdersPage, OrdersPage.tsx:6' });
  assert.deepEqual(m['coverage.runtime'].itemLabels, { 'unit:28f4fe2e81302a5a': 'handler in ListPage, ListPage.tsx:7' });
  assert.deepEqual(m['health.noBase'].itemLabels, { 'item:billing/components/InvoiceCard': 'InvoiceCard' });
  // A unit node with no file of its own (the real graph) takes where it sits from its PART_OF edge.
  const bare = { ...MOCK_KNOWS_GRAPH, nodes: MOCK_KNOWS_GRAPH.nodes.map((x) => (x.kind === 'unit' ? { id: x.id, kind: x.kind, label: x.label, hash: x.hash } : x)) };
  assert.equal(byId(computeSmart({ ...INPUTS, graph: bare }))['coverage.tested'].itemLabels['unit:6fad22416fa70dad'], 'handler in OrdersPage, OrdersPage.tsx:6');
  // An id the graph does not know falls back to its id without the kind; a number with no graph items carries no labels.
  assert.equal(itemLabeler(MOCK_KNOWS_GRAPH)('unit:ffffeeee00001111'), 'ffffeeee00001111');
  assert.equal(itemLabeler(MOCK_KNOWS_GRAPH)('item:gone/pages/Gone'), 'gone/pages/Gone');
  assert.equal(m['ai.accepted'].itemLabels, undefined);
  assert.equal(m['health.unresolved'].itemLabels, undefined);
});

test('#856 itemLabels is additive: a view without it still fits the contract, a malformed one is refused', () => {
  const v = computeSmart(INPUTS);
  assertSmartView({ ...v, metrics: v.metrics.map(({ itemLabels, ...rest }) => rest) });
  const bad = { ...v, metrics: v.metrics.map((x) => (x.id === 'coverage.tested' ? { ...x, itemLabels: { 'unit:6fad22416fa70dad': '' } } : x)) };
  assert.throws(() => assertSmartView(bad), /itemLabels/);
  const notAnItem = { ...v, metrics: v.metrics.map((x) => (x.id === 'coverage.tested' ? { ...x, itemLabels: { 'unit:nope': 'x' } } : x)) };
  assert.throws(() => assertSmartView(notAnItem), /itemLabels/);
});

test('How smart is it lists each AI step\'s on and win from the profiles (the one switch)', () => {
  const aiSteps = [{ step: 'construct.fix', on: true, win: 'measured 9/10 vs static 6/10' }, { step: 'trace.choose', on: false, win: 'off' }];
  const m = byId(computeSmart({ ...INPUTS, aiSteps }))['ai.staticShare'];
  assert.deepEqual(m.details, ['3 decided by rules, 1 by a model', 'construct.fix is on: measured 9/10 vs static 6/10', '1 of 2 AI steps are off, so static code answers them']);
  const empty = byId(computeSmart({ ...INPUTS, decisions: null, aiSteps }))['ai.staticShare'];
  assert.equal(empty.value, null);
  assert.equal(empty.details.length, 2);
  const dir = fs.realpathSync(makeTempDir('line-smart-ai-'));
  let real;
  try { real = readSmartInputs(dir, { nodes: [], edges: [] }).aiSteps; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(real.length > 0 && real.every((p) => typeof p.on === 'boolean' && typeof p.win === 'string'), 'read with stepOn and stepWin, as /api/line/ai-profiles serves them');
  assert.ok(real.filter((p) => p.on).every((p) => p.win !== 'off'), 'a step that is on carries its measured win');
});
