// Line graph queries: neighbours by type and layer to a depth, who calls a node, and what a change to a node impacts.
// Pure over a LineGraph (contract.mjs); results are sorted ids.

/** @typedef {import('./contract.mjs').LineGraph} LineGraph */
/** @typedef {import('./contract.mjs').GraphEdge} GraphEdge */
/** @typedef {import('./contract.mjs').GraphEdgeType} GraphEdgeType */
/** @typedef {import('./contract.mjs').GraphLayer} GraphLayer */

/** Edge types that mean "uses at run time": a caller of X has one of these to X. */
export const CALL_TYPES = Object.freeze(/** @type {GraphEdgeType[]} */ (['CALLS', 'RENDERS', 'USES_HOOK', 'HANDLES_EVENT', 'CALLED_AT_RUNTIME']));
/** Edge types along which a change travels back to whoever depends on the changed node. */
export const IMPACT_TYPES = Object.freeze(/** @type {GraphEdgeType[]} */ (['IMPORTS', 'BASED_ON', ...CALL_TYPES, 'READS_FIELD', 'WRITES_FIELD', 'COVERS', 'FLAGS']));

/**
 * Queries over one graph (indexes are built once).
 * @param {LineGraph} graph
 * @returns {{neighbors: (id: string, o?: {types?: GraphEdgeType[], layers?: GraphLayer[], depth?: number, direction?: 'out'|'in'|'both'}) => string[], whoCalls: (id: string) => string[], impactOf: (id: string) => string[]}}
 */
export function queryGraph(graph) {
  /** @type {Map<string, GraphEdge[]>} */
  const out = new Map();
  /** @type {Map<string, GraphEdge[]>} */
  const inn = new Map();
  for (const e of graph.edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)?.push(e);
    if (!inn.has(e.to)) inn.set(e.to, []);
    inn.get(e.to)?.push(e);
  }
  /**
   * Nodes reachable from `id` within `depth` hops over edges of the given types and layers.
   * @param {string} id
   * @param {{types?: GraphEdgeType[], layers?: GraphLayer[], depth?: number, direction?: 'out'|'in'|'both'}} [o]
   * @returns {string[]}
   */
  const neighbors = (id, { types, layers, depth = 1, direction = 'out' } = {}) => {
    const ok = (/** @type {GraphEdge} */ e) => (!types || types.includes(e.type)) && (!layers || layers.includes(e.layer));
    const seen = new Set([id]);
    let frontier = [id];
    for (let d = 0; d < depth && frontier.length; d += 1) {
      const next = [];
      for (const n of frontier) {
        const hops = [
          ...(direction !== 'in' ? (out.get(n) ?? []).filter(ok).map((e) => e.to) : []),
          ...(direction !== 'out' ? (inn.get(n) ?? []).filter(ok).map((e) => e.from) : []),
        ];
        for (const m of hops) if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
      frontier = next;
    }
    seen.delete(id);
    return [...seen].sort();
  };
  /**
   * The nodes that call, render, use as a hook, handle events of, or were seen calling `id` at run time.
   * @param {string} id
   * @returns {string[]}
   */
  const whoCalls = (id) => neighbors(id, { types: [...CALL_TYPES], direction: 'in' });
  /**
   * Every node a change to `id` may impact: its dependents, transitively (importers, items based on it, callers,
   * renderers, spec points covering it, findings flagging it), plus the route of every impacted page.
   * @param {string} id
   * @returns {string[]}
   */
  const impactOf = (id) => {
    const hit = new Set(neighbors(id, { types: [...IMPACT_TYPES], direction: 'in', depth: Number.MAX_SAFE_INTEGER }));
    for (const n of [id, ...hit]) for (const e of out.get(n) ?? []) if (e.type === 'PART_OF' && e.to.startsWith('route:')) hit.add(e.to);
    hit.delete(id);
    return [...hit].sort();
  };
  return { neighbors, whoCalls, impactOf };
}

/**
 * Nodes reachable from `id` (queryGraph(graph).neighbors, for one query).
 * @param {LineGraph} graph
 * @param {string} id
 * @param {{types?: GraphEdgeType[], layers?: GraphLayer[], depth?: number, direction?: 'out'|'in'|'both'}} [o]
 * @returns {string[]}
 */
export const neighbors = (graph, id, o) => queryGraph(graph).neighbors(id, o);
/**
 * Who calls, renders, uses or handles events of `id` (queryGraph(graph).whoCalls, for one query).
 * @param {LineGraph} graph
 * @param {string} id
 * @returns {string[]}
 */
export const whoCalls = (graph, id) => queryGraph(graph).whoCalls(id);
/**
 * Every node a change to `id` may impact (queryGraph(graph).impactOf, for one query).
 * @param {LineGraph} graph
 * @param {string} id
 * @returns {string[]}
 */
export const impactOf = (graph, id) => queryGraph(graph).impactOf(id);
