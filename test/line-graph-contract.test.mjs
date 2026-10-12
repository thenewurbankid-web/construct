// Line graph contract (G1): every shape is checked, and every refusal is one sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGraphNode, assertGraphEdge, assertRuntimeEdge, assertGraphIndex, assertLineGraph, countGraph,
  EDGE_LAYER, EDGE_TYPES, LAYERS, NODE_KINDS,
} from '../packages/engine/line/graph/contract.mjs';
import { MOCK_LINE_GRAPH, MOCK_RUNTIME_EDGE } from '../packages/engine/line/graph/mock.mjs';

const oneSentence = (re) => (e) => e instanceof TypeError && re.test(e.message) && /^[A-Z].*\.$/.test(e.message) && e.message.split('. ').length === 1;
const node = () => structuredClone(MOCK_LINE_GRAPH.nodes.find((n) => n.id === 'item:orders/pages/OrdersPage'));
const edge = () => structuredClone(MOCK_LINE_GRAPH.edges[0]);
const nodesById = new Map(MOCK_LINE_GRAPH.nodes.map((n) => [n.id, n]));

test('the mock graph passes the contract and covers every layer and node kind', () => {
  assertLineGraph(MOCK_LINE_GRAPH);
  assert.deepEqual([...new Set(MOCK_LINE_GRAPH.edges.map((e) => e.layer))].sort(), [...LAYERS].sort());
  assert.deepEqual([...new Set(MOCK_LINE_GRAPH.nodes.map((n) => n.kind))].sort(), [...NODE_KINDS].sort());
  assertRuntimeEdge(MOCK_RUNTIME_EDGE, nodesById);
});

test('every edge type has exactly one layer', () => {
  assert.equal(EDGE_TYPES.length, 17);
  for (const t of EDGE_TYPES) assert.ok(LAYERS.includes(EDGE_LAYER[t]));
});

test('node shape: kind, id prefix, label, hash, attrs and no extra fields', () => {
  assert.throws(() => assertGraphNode({ ...node(), kind: 'file' }), oneSentence(/kind must be one of/));
  assert.throws(() => assertGraphNode({ ...node(), id: 'unit:x' }), oneSentence(/must start with "item:"/));
  assert.throws(() => assertGraphNode({ ...node(), label: '' }), oneSentence(/label must be a non-empty string/));
  assert.throws(() => assertGraphNode({ ...node(), label: 'return <ListPage title="Orders" />;' }), oneSentence(/no code in it/));
  assert.throws(() => assertGraphNode({ ...node(), hash: 'abc' }), oneSentence(/hash must be "sha256:"/));
  assert.throws(() => assertGraphNode({ ...node(), line: 0 }), oneSentence(/line must be an integer from 1/));
  assert.throws(() => assertGraphNode({ ...node(), attrs: { body: 'x' } }), oneSentence(/attr body must be one of/));
  assert.throws(() => assertGraphNode({ ...node(), source: 'export function OrdersPage() {}' }), oneSentence(/carry only id, kind, label, file, line, hash and attrs, not source/));
  assert.throws(() => assertGraphNode({ ...node(), embedding: [0.1] }), oneSentence(/not embedding/));
});

test('edge shape: type, layer, evidence, ends and no extra fields', () => {
  assert.throws(() => assertGraphEdge({ ...edge(), type: 'USES' }), oneSentence(/type must be one of/));
  assert.throws(() => assertGraphEdge({ ...edge(), layer: 'static' }), oneSentence(/layer must be structure for a BASED_ON edge/));
  assert.throws(() => assertGraphEdge({ ...edge(), evidence: { file: 'a.ts' } }), oneSentence(/evidence line must be an integer/));
  assert.throws(() => assertGraphEdge({ ...edge(), evidence: null }), oneSentence(/evidence must be/));
  assert.throws(() => assertGraphEdge({ ...edge(), code: 'x' }), oneSentence(/not code/));
  assert.throws(() => assertGraphEdge({ ...edge(), to: 'item:nope' }, nodesById), oneSentence(/to item:nope must be a node of the graph/));
  assert.throws(() => assertGraphEdge({ ...edge(), to: 'library' }, nodesById), oneSentence(/must be a item for a BASED_ON edge/));
  assert.throws(() => assertGraphEdge({ ...MOCK_RUNTIME_EDGE, evidence: { file: 'a.ts', line: 1 } }), oneSentence(/runtime\) must carry the test/));
  assert.throws(() => assertRuntimeEdge({ ...edge() }), oneSentence(/layer must be structure|type must be CALLED_AT_RUNTIME/));
  assert.throws(() => assertGraphEdge({ ...MOCK_RUNTIME_EDGE, evidence: { test: 't', count: 0 } }), oneSentence(/count must be an integer from 1/));
});

test('index and graph: version, hashes, counts, unique ids and edges', () => {
  assertGraphIndex(MOCK_LINE_GRAPH.index);
  assert.throws(() => assertGraphIndex({ ...MOCK_LINE_GRAPH.index, version: 2 }), oneSentence(/version must be 1/));
  assert.throws(() => assertGraphIndex({ ...MOCK_LINE_GRAPH.index, files: { 'a.ts': 'x' } }), oneSentence(/hash of a\.ts must be/));
  const g = structuredClone(MOCK_LINE_GRAPH);
  assert.throws(() => assertLineGraph({ ...g, nodes: [...g.nodes, g.nodes[0]] }), oneSentence(/node id library must be unique/));
  assert.throws(() => assertLineGraph({ ...g, edges: [...g.edges, g.edges[0]] }), oneSentence(/appear once per evidence/));
  assert.throws(() => assertLineGraph({ ...g, index: { ...g.index, counts: countGraph(g.nodes, g.edges.slice(1)) } }), oneSentence(/edge count must be/));
});
