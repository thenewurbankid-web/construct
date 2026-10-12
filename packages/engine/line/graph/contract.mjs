// Line knowledge graph (G1): the ONE graph of a Line project, built from static analysis (and, from G2, a runtime call
// graph). No code embeddings, no code text: a node is an id, a kind, a label, an optional file:line and a hash; an edge
// is two ids, a type, a layer and its evidence (a file:line, or the test that observed it).
//
// Layers and their edge types (closed lists below):
//   structure  IMPORTS, BASED_ON, IN_FEATURE, IN_LIBRARY, PART_OF  (moduleEdges, base links, classify, importGraph)
//   static     CALLS, RENDERS, USES_HOOK, HANDLES_EVENT            (TypeScript checker: symbols, not text)
//   domain     READS_FIELD, WRITES_FIELD, SERVES, MAPS_TO          (stub; G3 fills it)
//   process    COVERS, FLAGS, CHANGES                              (spec points, findings, plan steps)
//   runtime    CALLED_AT_RUNTIME                                   (reserved; G2 fills it, evidence {test})
//
// Node ids (stable, never a position):
//   item       item:<line item id>   library "item:library/components/Button", feature "item:orders/pages/OrdersPage"
//   unit       unit:<fingerprint>    (logic-map unit, importV2 LogicUnit.fingerprint)
//   feature    feature:<name>        library   library      (the targets of IN_FEATURE / IN_LIBRARY)
//   route      route:<path>          endpoint  endpoint:<METHOD> <path>     field  field:<entity>.<name>
//   table      table:<name>          specPoint spec:<feature>#<n>           finding finding:<rule>|<file>|<line>
//   planStep   step:<plan id>#<step id>
// Directions: IMPORTS/CALLS/RENDERS/USES_HOOK from the user to the used; BASED_ON feature item -> library item;
// IN_FEATURE item -> feature; IN_LIBRARY item -> library; PART_OF unit -> item and page -> route; HANDLES_EVENT the
// item that supplies the handler -> the item whose element raises the event; SERVES route -> endpoint; MAPS_TO
// field -> table; READS_FIELD/WRITES_FIELD item|unit -> field; COVERS specPoint -> item; FLAGS finding -> item;
// CHANGES planStep -> item; CALLED_AT_RUNTIME caller -> callee (item or unit), observed by a test.

/**
 * @typedef {'item'|'unit'|'feature'|'library'|'route'|'endpoint'|'field'|'table'|'specPoint'|'finding'|'planStep'} GraphNodeKind
 * @typedef {'structure'|'static'|'domain'|'process'|'runtime'} GraphLayer
 * @typedef {'IMPORTS'|'BASED_ON'|'IN_FEATURE'|'IN_LIBRARY'|'PART_OF'|'CALLS'|'RENDERS'|'USES_HOOK'|'HANDLES_EVENT'|'READS_FIELD'|'WRITES_FIELD'|'SERVES'|'MAPS_TO'|'COVERS'|'FLAGS'|'CHANGES'|'CALLED_AT_RUNTIME'} GraphEdgeType
 */

/**
 * A node. `hash` is "sha256:<16 hex>": of the file's content for an item, the fingerprint for a unit, the record it
 * came from otherwise. `attrs` holds closed, short, code-free facts (see NODE_ATTRS).
 * @typedef {{id: string, kind: GraphNodeKind, label: string, file?: string, line?: number, hash: string, attrs?: Record<string, string|string[]>}} GraphNode
 */

/**
 * Where an edge was seen: a source position (static analysis) or a test that observed it at runtime.
 * @typedef {{file: string, line: number}} SourceEvidence
 * @typedef {{test: string, count?: number}} TestEvidence
 * @typedef {SourceEvidence|TestEvidence} GraphEvidence
 */

/**
 * An edge.
 * @typedef {{from: string, to: string, type: GraphEdgeType, layer: GraphLayer, evidence: GraphEvidence}} GraphEdge
 */

/**
 * A runtime edge as G2 writes it (CALLED_AT_RUNTIME, evidence {test, count?}).
 * @typedef {{from: string, to: string, type: 'CALLED_AT_RUNTIME', layer: 'runtime', evidence: TestEvidence}} RuntimeEdge
 */

/**
 * The index stored beside nodes.jsonl and edges.jsonl: the content hash of every analysed file (the incremental
 * cache key) and the counts.
 * @typedef {{version: 1, files: Record<string, string>, counts: GraphCounts}} GraphIndex
 * @typedef {{nodes: number, edges: number, byKind: Record<string, number>, byLayer: Record<string, number>, byType: Record<string, number>}} GraphCounts
 */

/**
 * The whole graph in memory.
 * @typedef {{nodes: GraphNode[], edges: GraphEdge[], index: GraphIndex}} LineGraph
 */

export const GRAPH_VERSION = 1;
export const NODE_KINDS = Object.freeze(/** @type {GraphNodeKind[]} */ (['item', 'unit', 'feature', 'library', 'route', 'endpoint', 'field', 'table', 'specPoint', 'finding', 'planStep']));
export const LAYERS = Object.freeze(/** @type {GraphLayer[]} */ (['structure', 'static', 'domain', 'process', 'runtime']));
/** Edge type -> its layer (each type lives in exactly one layer). */
export const EDGE_LAYER = Object.freeze(/** @type {Record<GraphEdgeType, GraphLayer>} */ ({
  IMPORTS: 'structure', BASED_ON: 'structure', IN_FEATURE: 'structure', IN_LIBRARY: 'structure', PART_OF: 'structure',
  CALLS: 'static', RENDERS: 'static', USES_HOOK: 'static', HANDLES_EVENT: 'static',
  READS_FIELD: 'domain', WRITES_FIELD: 'domain', SERVES: 'domain', MAPS_TO: 'domain',
  COVERS: 'process', FLAGS: 'process', CHANGES: 'process',
  CALLED_AT_RUNTIME: 'runtime',
}));
export const EDGE_TYPES = Object.freeze(/** @type {GraphEdgeType[]} */ (Object.keys(EDGE_LAYER)));
/** Allowed node-kind pairs per edge type ([from kinds, to kinds]). */
export const EDGE_ENDS = Object.freeze(/** @type {Record<GraphEdgeType, [GraphNodeKind[], GraphNodeKind[]]>} */ ({
  IMPORTS: [['item'], ['item']], BASED_ON: [['item'], ['item']], IN_FEATURE: [['item'], ['feature']], IN_LIBRARY: [['item'], ['library']],
  PART_OF: [['unit', 'item'], ['item', 'route']],
  CALLS: [['item', 'unit'], ['item', 'unit']], RENDERS: [['item'], ['item']], USES_HOOK: [['item', 'unit'], ['item']], HANDLES_EVENT: [['item', 'unit'], ['item']],
  READS_FIELD: [['item', 'unit'], ['field']], WRITES_FIELD: [['item', 'unit'], ['field']], SERVES: [['route'], ['endpoint']], MAPS_TO: [['field'], ['table']],
  COVERS: [['specPoint'], ['item']], FLAGS: [['finding'], ['item']], CHANGES: [['planStep'], ['item']],
  CALLED_AT_RUNTIME: [['item', 'unit'], ['item', 'unit']],
}));
/** Id prefix per node kind ('library' is the one fixed id). */
export const ID_PREFIX = Object.freeze(/** @type {Record<GraphNodeKind, string>} */ ({
  item: 'item:', unit: 'unit:', feature: 'feature:', library: 'library', route: 'route:', endpoint: 'endpoint:', field: 'field:', table: 'table:', specPoint: 'spec:', finding: 'finding:', planStep: 'step:',
}));
/** The attrs a node may carry (closed): an item's area, feature, Line kind and classify layers; a unit's logic kind. */
export const NODE_ATTRS = Object.freeze(['area', 'feature', 'itemKind', 'level', 'layers', 'unitKind', 'rule', 'severity']);
/** Where the graph is stored, under Line's state folder, through writeLineState. */
export const GRAPH_DIR = 'line/graph';
export const GRAPH_FILES = Object.freeze({ nodes: `${GRAPH_DIR}/nodes.jsonl`, edges: `${GRAPH_DIR}/edges.jsonl`, index: `${GRAPH_DIR}/index.json` });
/** Longest label: a name or a short sentence, never a code excerpt. */
export const MAX_LABEL = 120;

// ---------------------------------------------------------------------------------------------
// Runtime shape checks. Each refusal is one sentence: "<where> must <what>."

const fail = (where, what) => { throw new TypeError(`${where} must ${what}.`); };
const str = (v, where) => { if (typeof v !== 'string' || v.length === 0) fail(where, 'be a non-empty string'); };
const oneOf = (v, list, where) => { if (!list.includes(v)) fail(where, `be one of ${list.join(', ')}`); };
const int = (v, where, min = 0) => { if (!Number.isInteger(v) || v < min) fail(where, `be an integer from ${min}`); };
const HASH = /^sha256:[0-9a-f]{16}$/;
// Code text never belongs in a label: no braces, semicolons, arrows, JSX tags or line breaks.
const CODE_LIKE = /[{};\n]|=>|<\/?[A-Za-z]/;

/**
 * Throw a one-sentence TypeError unless `n` is a GraphNode.
 * @param {any} n
 * @param {string} [where]
 * @returns {asserts n is GraphNode}
 */
export function assertGraphNode(n, where = 'The graph node') {
  if (!n || typeof n !== 'object') fail(where, 'be an object');
  str(n.id, `${where}'s id`);
  oneOf(n.kind, NODE_KINDS, `${where}'s kind`);
  const prefix = ID_PREFIX[/** @type {GraphNodeKind} */ (n.kind)];
  if (n.kind === 'library' ? n.id !== 'library' : !n.id.startsWith(prefix) || n.id.length === prefix.length) fail(`${where}'s id ${n.id}`, `start with "${prefix}" for a ${n.kind}`);
  str(n.label, `${where}'s label`);
  if (n.label.length > MAX_LABEL || CODE_LIKE.test(n.label)) fail(`${where}'s label`, `be a name of at most ${MAX_LABEL} characters with no code in it`);
  if (n.file !== undefined) str(n.file, `${where}'s file`);
  if (n.line !== undefined) int(n.line, `${where}'s line`, 1);
  if (typeof n.hash !== 'string' || !HASH.test(n.hash)) fail(`${where}'s hash`, 'be "sha256:" and 16 hex characters');
  if (n.attrs !== undefined) {
    if (!n.attrs || typeof n.attrs !== 'object' || Array.isArray(n.attrs)) fail(`${where}'s attrs`, 'be an object');
    for (const [k, v] of Object.entries(n.attrs)) {
      oneOf(k, NODE_ATTRS, `${where}'s attr ${k}`);
      const vals = Array.isArray(v) ? v : [v];
      vals.forEach((x) => { if (typeof x !== 'string' || x.length > MAX_LABEL || CODE_LIKE.test(x)) fail(`${where}'s attr ${k}`, 'be short code-free text'); });
    }
  }
  const extra = Object.keys(n).filter((k) => !['id', 'kind', 'label', 'file', 'line', 'hash', 'attrs'].includes(k));
  if (extra.length) fail(`${where} (${n.id})`, `carry only id, kind, label, file, line, hash and attrs, not ${extra.join(', ')}`);
}

/**
 * Throw a one-sentence TypeError unless `e` is a GraphEdge whose type sits in its layer. With `nodes`, both ends must
 * exist and have kinds the type allows.
 * @param {any} e
 * @param {Map<string, GraphNode>} [nodes]
 * @param {string} [where]
 * @returns {asserts e is GraphEdge}
 */
export function assertGraphEdge(e, nodes, where = 'The graph edge') {
  if (!e || typeof e !== 'object') fail(where, 'be an object');
  str(e.from, `${where}'s from`);
  str(e.to, `${where}'s to`);
  oneOf(e.type, EDGE_TYPES, `${where}'s type`);
  if (e.layer !== EDGE_LAYER[/** @type {GraphEdgeType} */ (e.type)]) fail(`${where}'s layer`, `be ${EDGE_LAYER[/** @type {GraphEdgeType} */ (e.type)]} for a ${e.type} edge`);
  const ev = e.evidence;
  if (!ev || typeof ev !== 'object') fail(`${where}'s evidence`, 'be {file, line} or {test}');
  if ('test' in ev) {
    str(ev.test, `${where}'s evidence test`);
    if (ev.count !== undefined) int(ev.count, `${where}'s evidence count`, 1);
  } else {
    str(ev.file, `${where}'s evidence file`);
    int(ev.line, `${where}'s evidence line`, 1);
  }
  if (e.layer === 'runtime' && !('test' in ev)) fail(`${where} (runtime)`, 'carry the test that observed it as evidence');
  const extra = Object.keys(e).filter((k) => !['from', 'to', 'type', 'layer', 'evidence'].includes(k));
  if (extra.length) fail(`${where} (${e.from} ${e.type} ${e.to})`, `carry only from, to, type, layer and evidence, not ${extra.join(', ')}`);
  if (nodes) {
    const [fromKinds, toKinds] = EDGE_ENDS[/** @type {GraphEdgeType} */ (e.type)];
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a) fail(`${where}'s from ${e.from}`, 'be a node of the graph');
    if (!b) fail(`${where}'s to ${e.to}`, 'be a node of the graph');
    if (!fromKinds.includes(/** @type {any} */ (a).kind)) fail(`${where}'s from ${e.from}`, `be a ${fromKinds.join(' or ')} for a ${e.type} edge`);
    if (!toKinds.includes(/** @type {any} */ (b).kind)) fail(`${where}'s to ${e.to}`, `be a ${toKinds.join(' or ')} for a ${e.type} edge`);
  }
}

/**
 * Throw a one-sentence TypeError unless `e` is a RuntimeEdge (the shape G2 writes).
 * @param {any} e
 * @param {Map<string, GraphNode>} [nodes]
 * @returns {asserts e is RuntimeEdge}
 */
export function assertRuntimeEdge(e, nodes) {
  assertGraphEdge(e, nodes, 'The runtime edge');
  if (e.type !== 'CALLED_AT_RUNTIME') fail("The runtime edge's type", 'be CALLED_AT_RUNTIME');
}

/**
 * Throw a one-sentence TypeError unless `x` is a GraphIndex.
 * @param {any} x
 * @returns {asserts x is GraphIndex}
 */
export function assertGraphIndex(x) {
  if (!x || typeof x !== 'object') fail('The graph index', 'be an object');
  if (x.version !== GRAPH_VERSION) fail("The graph index's version", `be ${GRAPH_VERSION}`);
  if (!x.files || typeof x.files !== 'object') fail("The graph index's files", 'be an object of file -> hash');
  for (const [f, h] of Object.entries(x.files)) if (typeof h !== 'string' || !HASH.test(h)) fail(`The graph index's hash of ${f}`, 'be "sha256:" and 16 hex characters');
  const c = x.counts;
  if (!c || typeof c !== 'object') fail("The graph index's counts", 'be an object');
  int(c.nodes, "The graph index's node count");
  int(c.edges, "The graph index's edge count");
  for (const k of ['byKind', 'byLayer', 'byType']) if (!c[k] || typeof c[k] !== 'object') fail(`The graph index's ${k}`, 'be an object of counts');
}

/**
 * Throw a one-sentence TypeError unless `g` is a LineGraph: unique node ids, every edge valid against the nodes, no
 * duplicate edge, and counts that match.
 * @param {any} g
 * @returns {asserts g is LineGraph}
 */
export function assertLineGraph(g) {
  if (!g || typeof g !== 'object') fail('The line graph', 'be an object');
  if (!Array.isArray(g.nodes)) fail("The line graph's nodes", 'be an array');
  if (!Array.isArray(g.edges)) fail("The line graph's edges", 'be an array');
  /** @type {Map<string, GraphNode>} */
  const nodes = new Map();
  g.nodes.forEach((n, i) => {
    assertGraphNode(n, `Graph node ${i}`);
    if (nodes.has(n.id)) fail(`The node id ${n.id}`, 'be unique in the graph');
    nodes.set(n.id, n);
  });
  const seen = new Set();
  g.edges.forEach((e, i) => {
    assertGraphEdge(e, nodes, `Graph edge ${i}`);
    const k = edgeKey(e);
    if (seen.has(k)) fail(`The edge ${e.from} ${e.type} ${e.to}`, 'appear once per evidence');
    seen.add(k);
  });
  assertGraphIndex(g.index);
  if (g.index.counts.nodes !== g.nodes.length) fail("The graph index's node count", `be ${g.nodes.length}`);
  if (g.index.counts.edges !== g.edges.length) fail("The graph index's edge count", `be ${g.edges.length}`);
}

/**
 * One edge's identity (its ends, type and evidence).
 * @param {GraphEdge} e
 * @returns {string}
 */
export const edgeKey = (e) => `${e.from}\u0000${e.type}\u0000${e.to}\u0000${'test' in e.evidence ? `test:${e.evidence.test}` : `${e.evidence.file}:${e.evidence.line}`}`;

/**
 * The counts of a node and edge list (the index's form).
 * @param {GraphNode[]} nodes
 * @param {GraphEdge[]} edges
 * @returns {GraphCounts}
 */
export function countGraph(nodes, edges) {
  const tally = (xs, key) => { /** @type {Record<string, number>} */ const o = {}; for (const x of xs) o[key(x)] = (o[key(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort()); };
  return { nodes: nodes.length, edges: edges.length, byKind: tally(nodes, (n) => n.kind), byLayer: tally(edges, (e) => e.layer), byType: tally(edges, (e) => e.type) };
}
