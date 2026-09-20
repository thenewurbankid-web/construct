// #351 -- the changed-units tree's keyboard model, as pure data. The real-browser proof is
// ui/e2e/tests/review-tree-keyboard.spec.js; this pins every key of the ARIA tree pattern.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenVisible, navigate, tabStop } from './TreeNav.ts';
import { buildTreeNodes, findFileNode, findNode } from './TreeNodes.ts';
import { groupByFeature } from './FeatureGrouping.ts';
import { groupByLayer } from './LayerGrouping.ts';
import { flatFiles } from './TreeFiles.ts';
import { changeReducer, initialChange } from '../workflows/ChangeMachine.ts';
import { describeFailure } from './FailureView.ts';
import { pendingText } from './Badges.ts';
import { listIsSettling, listReducer, initialList } from '../workflows/ListMachine.ts';

const f = (path, feature, layer, status = 'M') => ({ path, status, feature, layer, scope: feature ?? '.' });
const FILES = [
  f('features/billing/domain/billingRules.ts', 'billing', 'domain'),
  f('features/billing/services/billingService.ts', 'billing', 'service'),
  f('features/checkout/domain/checkoutRules.ts', 'checkout', 'domain'),
  f('README.md', null, null),
];
const nodes = (g = 'feature') => buildTreeNodes(g, groupByFeature(FILES), groupByLayer(FILES), flatFiles(FILES));
const open = (closed = []) => (id) => !closed.includes(id);
const rows = (g, closed = []) => flattenVisible(nodes(g), open(closed));
const ids = (rs) => rs.map((r) => r.id);

test('by feature the tree is feature > layer > file, every id unique, and the testids the screen relies on are kept', () => {
  const n = nodes('feature');
  assert.deepEqual(n.map((x) => x.testId), ['review-feature', 'review-feature', 'review-feature']);
  assert.equal(n[0].data['data-feature'], 'billing');
  assert.deepEqual(n[0].children.map((x) => [x.testId, x.data['data-layer']]), [['review-layer', 'domain'], ['review-layer', 'service']]);
  assert.equal(n[0].children[0].children[0].testId, 'review-file');
  const all = ids(rows('feature'));
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 3 + 4 + 4, 'feature rows, layer rows and file rows');
});

test('by layer and flat groupings are trees too (a flat list is a tree with no parents)', () => {
  assert.equal(nodes('layer')[0].testId, 'review-layer-group');
  assert.ok(nodes('layer').every((x) => x.children.length > 0));
  const flat = nodes('files');
  assert.ok(flat.every((x) => x.kind === 'file' && x.showLayer && x.children.length === 0));
  assert.equal(flat.length, FILES.length);
});

test('Down and Up move between VISIBLE rows and stop at the ends', () => {
  const r = rows('feature');
  assert.equal(navigate('ArrowDown', r, r[0].id, open()).focus, r[1].id);
  assert.equal(navigate('ArrowUp', r, r[1].id, open()).focus, r[0].id);
  assert.equal(navigate('ArrowUp', r, r[0].id, open()).focus, r[0].id);
  assert.equal(navigate('ArrowDown', r, r[r.length - 1].id, open()).focus, r[r.length - 1].id);
});

test('a closed parent hides its children from Down/Up', () => {
  const billing = nodes('feature')[0].id;
  const r = rows('feature', [billing]);
  assert.equal(r.some((x) => x.parentId === billing), false);
  assert.equal(navigate('ArrowDown', r, billing, open([billing])).focus, nodes('feature')[1].id, 'Down from a closed parent skips its subtree');
});

test('Home and End go to the first and last visible row', () => {
  const r = rows('feature');
  assert.equal(navigate('Home', r, r[5].id, open()).focus, r[0].id);
  assert.equal(navigate('End', r, r[0].id, open()).focus, r[r.length - 1].id);
});

test('Right opens a closed parent, then moves to its first child; on a leaf it does nothing', () => {
  const n = nodes('feature');
  const billing = n[0];
  const closedRows = rows('feature', [billing.id]);
  assert.deepEqual(navigate('ArrowRight', closedRows, billing.id, open([billing.id])), { open: { id: billing.id, open: true } });
  const r = rows('feature');
  assert.deepEqual(navigate('ArrowRight', r, billing.id, open()), { focus: billing.children[0].id });
  const leaf = billing.children[0].children[0].id;
  assert.deepEqual(navigate('ArrowRight', r, leaf, open()), {});
});

test('Left closes an open parent, otherwise moves to the parent; at the top it does nothing', () => {
  const n = nodes('feature');
  const billing = n[0];
  const layer = billing.children[0];
  const file = layer.children[0];
  const r = rows('feature');
  assert.deepEqual(navigate('ArrowLeft', r, billing.id, open()), { open: { id: billing.id, open: false } });
  assert.deepEqual(navigate('ArrowLeft', r, file.id, open()), { focus: layer.id });
  const closedLayer = rows('feature', [layer.id]);
  assert.deepEqual(navigate('ArrowLeft', closedLayer, layer.id, open([layer.id])), { focus: billing.id });
  const flat = rows('files');
  assert.deepEqual(navigate('ArrowLeft', flat, flat[0].id, open()), {});
});

test('Enter or Space selects a file and toggles a parent; other keys are not the tree\'s', () => {
  const billing = nodes('feature')[0];
  const file = billing.children[0].children[0];
  const r = rows('feature');
  assert.deepEqual(navigate('Enter', r, file.id, open()), { activate: file.id });
  assert.deepEqual(navigate(' ', r, file.id, open()), { activate: file.id });
  assert.deepEqual(navigate('Enter', r, billing.id, open()), { open: { id: billing.id, open: false } });
  assert.equal(navigate('a', r, file.id, open()), null);
  assert.equal(navigate('Tab', r, file.id, open()), null, 'Tab is never captured: it leaves the tree');
  assert.equal(navigate('ArrowDown', r, 'not-a-row', open()), null);
});

test('exactly one row is the tab stop: the active row, else the selected file, else the first', () => {
  const r = rows('feature');
  const n = nodes('feature');
  const selected = n[1].children[0].children[0].id;
  assert.equal(tabStop(r, null, null), r[0].id);
  assert.equal(tabStop(r, null, selected), selected);
  assert.equal(tabStop(r, n[2].id, selected), n[2].id);
  const hidden = rows('feature', [n[1].id]);
  assert.equal(tabStop(hidden, selected, selected), hidden[0].id, 'a row hidden by a fold cannot be the tab stop');
  assert.equal(tabStop([], null, null), null);
});

test('a file is found by path, a node by id', () => {
  const n = nodes('feature');
  assert.equal(findFileNode(n, 'features/billing/services/billingService.ts').file.name, 'billingService.ts');
  assert.equal(findFileNode(n, 'nope'), null);
  assert.equal(findFileNode(n, null), null);
  assert.equal(findNode(n, n[1].id).label.length > 0, true);
});

// --- #351: an analysis can be cancelled --------------------------------------------------

test('a cancelled analysis is a stop the person asked for: it says so, offers to run again, and never restarts by itself', () => {
  const s = changeReducer(initialChange, { type: 'RESPONSE', data: { state: 'cancelled' } });
  assert.equal(s.status, 'failed');
  assert.equal(s.errorCode, 'CANCELLED');
  const v = describeFailure('CANCELLED', s.error);
  assert.match(v.title, /cancelled/i);
  assert.deepEqual(v.actions, ['retry', 'list']);
  assert.match(v.what, /Nothing was changed in your repository/);
  assert.equal(changeReducer(initialChange, { type: 'RESPONSE', data: { state: 'paused' } }).status, 'waiting');
});

test('a paused analysis reads as Paused and keeps the list polling; a cancelled one stops it', () => {
  assert.equal(pendingText('paused'), 'Paused');
  assert.equal(pendingText('cancelled'), null);
  const at = (state) => listReducer(initialList, { type: 'LOADED', data: { branches: [{ name: 'b', analysis: { state } }] } });
  assert.equal(listIsSettling(at('paused')), true);
  assert.equal(listIsSettling(at('cancelled')), false);
});
