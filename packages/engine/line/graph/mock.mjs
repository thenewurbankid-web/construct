// A fixed small Line graph for tests and for G2/G3 (runtime and domain layers) to build against: two library items,
// two feature items, one unit, one route, one finding, one spec point, one plan step, and one edge of every layer
// (domain and runtime included, so their shapes are pinned). Every value passes its assert* in contract.mjs.
import { countGraph, GRAPH_VERSION } from './contract.mjs';

/** @typedef {import('./contract.mjs').GraphNode} GraphNode */
/** @typedef {import('./contract.mjs').GraphEdge} GraphEdge */

const h = (/** @type {string} */ c) => `sha256:${c.repeat(16).slice(0, 16)}`;

/** @type {GraphNode[]} */
const nodes = [
  { id: 'library', kind: 'library', label: 'library', hash: h('0') },
  { id: 'feature:orders', kind: 'feature', label: 'orders', file: 'features/orders/spec.md', hash: h('1') },
  { id: 'item:library/components/Button', kind: 'item', label: 'Button', file: 'library/components/Button.tsx', line: 1, hash: h('2'), attrs: { area: 'library', itemKind: 'components', layers: ['component'] } },
  { id: 'item:library/pages/ListPage', kind: 'item', label: 'ListPage', file: 'library/pages/ListPage.tsx', line: 1, hash: h('3'), attrs: { area: 'library', itemKind: 'pages', layers: ['component'] } },
  { id: 'item:orders/pages/OrdersPage', kind: 'item', label: 'OrdersPage', file: 'features/orders/pages/OrdersPage.tsx', line: 1, hash: h('4'), attrs: { area: 'feature', feature: 'orders', itemKind: 'pages', layers: ['component'] } },
  { id: 'item:orders/components/OrderButton', kind: 'item', label: 'OrderButton', file: 'features/orders/components/OrderButton.tsx', line: 1, hash: h('5'), attrs: { area: 'feature', feature: 'orders', itemKind: 'components', layers: ['component'] } },
  { id: 'unit:0a1b2c3d4e5f6071', kind: 'unit', label: 'handler onMore', file: 'features/orders/pages/OrdersPage.tsx', line: 6, hash: h('6'), attrs: { unitKind: 'handler' } },
  { id: 'route:/orders', kind: 'route', label: '/orders', file: 'features/orders/pages/OrdersPage.tsx', line: 2, hash: h('7') },
  { id: 'endpoint:GET /api/orders', kind: 'endpoint', label: 'GET /api/orders', hash: h('8') },
  { id: 'field:Order.total', kind: 'field', label: 'Order.total', hash: h('9') },
  { id: 'table:orders', kind: 'table', label: 'orders', hash: h('a') },
  { id: 'spec:orders#1', kind: 'specPoint', label: 'A person sees their orders in a list.', file: 'features/orders/spec.md', line: 3, hash: h('b') },
  { id: 'finding:LINE-FEATURE-001|features/billing/pages/InvoicesPage.tsx|4', kind: 'finding', label: 'A feature uses another feature.', file: 'features/billing/pages/InvoicesPage.tsx', line: 4, hash: h('c'), attrs: { rule: 'LINE-FEATURE-001', severity: 'error' } },
  { id: 'step:plan-1#s1', kind: 'planStep', label: 'Add the orders page.', hash: h('d') },
];

/** @type {GraphEdge[]} */
const edges = [
  { from: 'item:orders/pages/OrdersPage', to: 'item:library/pages/ListPage', type: 'BASED_ON', layer: 'structure', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 1 } },
  { from: 'item:orders/pages/OrdersPage', to: 'item:library/pages/ListPage', type: 'IMPORTS', layer: 'structure', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 3 } },
  { from: 'item:orders/pages/OrdersPage', to: 'feature:orders', type: 'IN_FEATURE', layer: 'structure', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 1 } },
  { from: 'item:library/pages/ListPage', to: 'library', type: 'IN_LIBRARY', layer: 'structure', evidence: { file: 'library/pages/ListPage.tsx', line: 1 } },
  { from: 'unit:0a1b2c3d4e5f6071', to: 'item:orders/pages/OrdersPage', type: 'PART_OF', layer: 'structure', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 6 } },
  { from: 'item:orders/pages/OrdersPage', to: 'route:/orders', type: 'PART_OF', layer: 'structure', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 2 } },
  { from: 'item:orders/pages/OrdersPage', to: 'item:library/pages/ListPage', type: 'RENDERS', layer: 'static', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 6 } },
  { from: 'item:library/pages/ListPage', to: 'item:library/components/Button', type: 'RENDERS', layer: 'static', evidence: { file: 'library/pages/ListPage.tsx', line: 7 } },
  { from: 'item:orders/pages/OrdersPage', to: 'item:library/pages/ListPage', type: 'HANDLES_EVENT', layer: 'static', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 6 } },
  { from: 'route:/orders', to: 'endpoint:GET /api/orders', type: 'SERVES', layer: 'domain', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 2 } },
  { from: 'item:orders/pages/OrdersPage', to: 'field:Order.total', type: 'READS_FIELD', layer: 'domain', evidence: { file: 'features/orders/pages/OrdersPage.tsx', line: 6 } },
  { from: 'field:Order.total', to: 'table:orders', type: 'MAPS_TO', layer: 'domain', evidence: { file: 'features/orders/spec.md', line: 3 } },
  { from: 'spec:orders#1', to: 'item:orders/pages/OrdersPage', type: 'COVERS', layer: 'process', evidence: { file: 'features/orders/spec.md', line: 3 } },
  { from: 'finding:LINE-FEATURE-001|features/billing/pages/InvoicesPage.tsx|4', to: 'item:orders/components/OrderButton', type: 'FLAGS', layer: 'process', evidence: { file: 'features/billing/pages/InvoicesPage.tsx', line: 4 } },
  { from: 'step:plan-1#s1', to: 'item:orders/pages/OrdersPage', type: 'CHANGES', layer: 'process', evidence: { test: 'plan-1#s1' } },
  { from: 'item:orders/pages/OrdersPage', to: 'item:library/pages/ListPage', type: 'CALLED_AT_RUNTIME', layer: 'runtime', evidence: { test: 'test/orders.test.tsx > shows orders', count: 1 } },
];

/** The fixed mock graph (frozen). */
export const MOCK_LINE_GRAPH = Object.freeze({
  nodes: Object.freeze(nodes),
  edges: Object.freeze(edges),
  index: Object.freeze({
    version: GRAPH_VERSION,
    files: { 'library/components/Button.tsx': h('2'), 'library/pages/ListPage.tsx': h('3'), 'features/orders/pages/OrdersPage.tsx': h('4'), 'features/orders/components/OrderButton.tsx': h('5') },
    counts: countGraph(nodes, edges),
  }),
});

/** One runtime edge as G2 writes it. */
export const MOCK_RUNTIME_EDGE = Object.freeze(edges[edges.length - 1]);
