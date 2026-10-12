// G2 runtime layer shapes. The graph's own shapes (GraphNode, GraphEdge, RuntimeEdge, assertRuntimeEdge) live in G1's
// ../contract.mjs; the edges mergeRuntime makes are its RuntimeEdge:
//   {from, to, type: 'CALLED_AT_RUNTIME', layer: 'runtime', evidence: {test, count?}}
// G1's edge carries ONLY from, to, type, layer and evidence, so argument and return SHAPES sit beside the edges in
// `RuntimeMerge.shapes`, keyed "<from> -> <to>". Node ids are G1's: a logic-map unit is `unit:<fingerprint>`.

/**
 * A recorded callee or caller, by module identity (never by position):
 *   export   {kind:'export', file, name, local?}            name is the export name ('default', or 'obj.method')
 *   handler  {kind:'handler', file, owner, prop, hash}      a JSX on* prop of `owner`; hash of its normalized text
 * @typedef {{kind: 'export', file: string, name: string, local?: string} | {kind: 'handler', file: string, owner: string, prop: string, hash: string}} RuntimeRef
 */

/**
 * One aggregated observation (records are deduplicated per test with a count). Shapes are type tags and keys only.
 *   call     from (null: an uninstrumented caller such as the test), to, args (one shape per argument), ret, via?
 *            ('render' | 'handler'), mocked? (the callee was a jest mock: recorded by module identity all the same)
 *   state    a React setter or useReducer dispatch: from, file, owner, key (the state's name), action? (action type)
 *   dispatch a redux dispatch: from, key (the action type)
 *   fetch    from, method, url (ids replaced by :id, query values dropped)
 *   load     an instrumented file was loaded: file
 * @typedef {{kind: 'call'|'state'|'dispatch'|'fetch'|'load', test: string|null, count: number, from?: RuntimeRef|null, to?: RuntimeRef, args?: string[], ret?: string, via?: string, mocked?: boolean, file?: string, owner?: string, key?: string, action?: string, method?: string, url?: string}} RuntimeRecord
 */

/**
 * @typedef {import('../contract.mjs').RuntimeEdge} RuntimeEdge
 * @typedef {{fingerprint: string, id: string, kind: string, file: string, fn: string, line: number}} UnreachedUnit
 * @typedef {{
 *   graph: {nodes: object[], edges: object[]},
 *   edges: RuntimeEdge[],
 *   shapes: Record<string, {args: string[], ret: string[]}>,
 *   io: {from: string|null, method: string, url: string, test: string|null, count: number}[],
 *   writes: {from: string|null, kind: 'state'|'dispatch', key: string, to: string|null, test: string|null}[],
 *   reached: string[], unreached: UnreachedUnit[], mocked: string[],
 *   unresolved: {ref: RuntimeRef, why: string}[],
 * }} RuntimeMerge
 * @typedef {{total: number, reached: string[], unreached: string[], mocked: string[], byKind: Record<string, {reached: number, total: number}>, sentence: string}} RuntimeCoverage
 */

import { EDGE_LAYER, ID_PREFIX } from '../contract.mjs';

export const RUNTIME_EDGE_TYPE = 'CALLED_AT_RUNTIME';
export const RUNTIME_LAYER = EDGE_LAYER[RUNTIME_EDGE_TYPE];
/** Env the recorders read. */
export const RUNTIME_ENV = Object.freeze({ dir: 'LINE_RUNTIME_DIR', root: 'LINE_RUNTIME_ROOT', files: 'LINE_RUNTIME_FILES' });

/**
 * G1's node id of a logic-map unit.
 * @param {{fingerprint: string}} u
 * @returns {string}
 */
export const unitNodeId = (u) => `${ID_PREFIX.unit}${u.fingerprint}`;
