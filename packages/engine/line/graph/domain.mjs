// Line graph, domain layer: READS_FIELD, WRITES_FIELD (item|unit -> field), SERVES (route -> endpoint) and MAPS_TO
// (field -> table). A stub in G1: it returns no nodes and no edges, and G3 fills it (Trace's route -> endpoint matcher,
// entity fields, tables). The shapes are pinned by contract.mjs and the mock's one edge of each type.

/**
 * The domain layer of a project (stub: empty until G3).
 * @param {string} _root
 * @param {unknown} _frame The builder's project frame (items by file, readLineProject's view).
 * @returns {{nodes: import('./contract.mjs').GraphNode[], edges: import('./contract.mjs').GraphEdge[]}}
 */
export function domainLayer(_root, _frame) {
  return { nodes: [], edges: [] };
}
