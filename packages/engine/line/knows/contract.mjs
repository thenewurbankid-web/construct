// "What Line knows" (owner, 2026-10-12): the Cockpit page that shows and changes Line's knowledge graph and memory, in
// plain words, with four tabs. This is the page's server contract: the routes, their shapes and one-sentence shape
// checks. Every route is an entry of the ONE tool registry (../toolRegistry.mjs); the client mirrors these shapes in
// ui/client/lib/lineKnowsContract.ts and runs on ./mock.mjs in mock mode (?line=mock).
//
//   Map              GET  /api/line/graph?focus=<node id>   GraphRead: G1's graph, and for a focus whoCalls/impactOf
//   Memory           GET  /api/line/memory                  im3's MemoryView (steps and sizes)        (lineMemoryApi.mjs)
//                    POST /api/line/memory/forget           {step}  forget one step                    (lineMemoryApi.mjs)
//                    GET  /api/line/memory/records?step=    MemoryRecordsView: im3's records, the embeddings switch, the log
//                    POST /api/line/memory/edit             {id, chosen}   correct one record          person only, logged
//                    POST /api/line/memory/forget-record    {id}                                       person only, logged
//                    POST /api/line/memory/forget-all       {}                                         person only, logged
//                    GET  /api/line/memory/export           im3's MemoryExport (a file the person keeps)
//                    POST /api/line/memory/import           im3's MemoryExport                          person only, logged
//                    POST /api/line/memory/embeddings       {on}  slotted decision text only, never code; off by default
//   Change           GET  /api/line/graph/changes?focus=    ChangeView: typed fixes the Map proposes; each one runs as a
//                                                           plan step (line.setBase, line.promote, line.fix) a person
//                                                           approves, through Construct's writer (no new write route)
//   How smart is it  GET  /api/line/graph/stats             SmartView: numbers on the person's own project, local
//                                                           records only; nothing leaves the machine
//
// Memory records are im3's (../memory/contract.mjs MemoryRecord, one line of <state>/memory/<step>.jsonl, slotted,
// no code). The page shows each as a MemoryRow (the client's view model: step, intent, outcome, count, when).
import { assertMemoryRecord, assertMemoryExport } from '../memory/contract.mjs';

/** @typedef {import('../graph/contract.mjs').LineGraph} LineGraph */
/** @typedef {import('../graph/contract.mjs').GraphLayer} GraphLayer */
/** @typedef {import('../memory/contract.mjs').MemoryRecord} MemoryRecord */
/** @typedef {import('../memory/contract.mjs').MemoryExport} MemoryExport */

/**
 * GET /api/line/graph. `focus` is present when the request named a node: who calls it and what a change to it may
 * break (graph/query.mjs whoCalls / impactOf), both sorted node ids.
 * @typedef {{ok: true, graph: LineGraph, sentence: string, focus?: {id: string, whoCalls: string[], impactOf: string[]}}} GraphRead
 */

/**
 * One memory change, as the log keeps it (who, what, which record or step; never the record's text).
 * @typedef {'edit'|'forget'|'forgetStep'|'forgetAll'|'import'|'embeddings'} MemoryAction
 * @typedef {{at: string, by: 'person', action: MemoryAction, target: string}} MemoryLogEntry
 */

/**
 * GET /api/line/memory/records (and every memory write's answer). `step` null: all steps. `embeddings.on` is false by
 * default; it covers slotted decision text only, never code.
 * @typedef {{ok: true, step: string|null, records: MemoryRecord[], embeddings: {on: boolean, covers: 'slotted-text'}, log: MemoryLogEntry[], sentence: string}} MemoryRecordsView
 */

/**
 * A typed fix the Map proposes. `kind`: re-base an item on a library item (line.setBase), promote a feature item to the
 * library (line.promote), or remove a cross-feature use (line.fix of its finding). `step` is the plan step it becomes.
 * @typedef {'rebase'|'promote'|'removeCrossUse'} ChangeKind
 * @typedef {{id: string, kind: ChangeKind, target: string, sentence: string, finding?: string, step: {tool: string, args: Record<string, unknown>}, details: string[]}} ChangeProposal
 * @typedef {{ok: true, proposals: ChangeProposal[], sentence: string}} ChangeView
 */

/**
 * One number of "How smart is it". `value` is a share 0..1 (null: a count, or no records yet); `trend` the earlier
 * values, oldest first; `improve` one sentence; `items` the node or plan-step ids behind it; `open` where a click goes.
 * @typedef {'coverage.tested'|'coverage.runtime'|'health.crossFeature'|'health.noBase'|'health.unresolved'|'health.duplicates'|'ai.accepted'|'ai.edited'|'ai.refused'|'ai.staticShare'|'ai.preferred'|'fixes.typed'|'memory.effect'} MetricId
 * @typedef {'coverage'|'health'|'ai'|'fixes'|'memory'} MetricGroup
 * @typedef {{id: MetricId, group: MetricGroup, label: string, value: number|null, count?: number, trend: (number|null)[], improve: string, items: string[], open: 'map'|'plan', details: string[]}} Metric
 * @typedef {{ok: true, metrics: Metric[], sentence: string, local: true}} SmartView
 */

export const KNOWS_API = Object.freeze({
  graph: { method: 'GET', path: '/api/line/graph' },
  changes: { method: 'GET', path: '/api/line/graph/changes' },
  stats: { method: 'GET', path: '/api/line/graph/stats' },
  memory: { method: 'GET', path: '/api/line/memory' },
  memoryForgetStep: { method: 'POST', path: '/api/line/memory/forget' },
  memoryRecords: { method: 'GET', path: '/api/line/memory/records' },
  memoryEdit: { method: 'POST', path: '/api/line/memory/edit' },
  memoryForgetRecord: { method: 'POST', path: '/api/line/memory/forget-record' },
  memoryForgetAll: { method: 'POST', path: '/api/line/memory/forget-all' },
  memoryExport: { method: 'GET', path: '/api/line/memory/export' },
  memoryImport: { method: 'POST', path: '/api/line/memory/import' },
  memoryEmbeddings: { method: 'POST', path: '/api/line/memory/embeddings' },
});

/** The four tabs, in order (stable ids: tests, Trace and the chat pick them by id). */
export const KNOWS_TABS = Object.freeze(/** @type {const} */ (['map', 'memory', 'change', 'smart']));
export const CHANGE_KINDS = Object.freeze(/** @type {ChangeKind[]} */ (['rebase', 'promote', 'removeCrossUse']));
/** The plan tool each change kind becomes. */
export const CHANGE_TOOL = Object.freeze(/** @type {Record<ChangeKind, string>} */ ({ rebase: 'line.setBase', promote: 'line.promote', removeCrossUse: 'line.fix' }));
export const MEMORY_ACTIONS = Object.freeze(/** @type {MemoryAction[]} */ (['edit', 'forget', 'forgetStep', 'forgetAll', 'import', 'embeddings']));
export const METRIC_IDS = Object.freeze(/** @type {MetricId[]} */ ([
  'coverage.tested', 'coverage.runtime', 'health.crossFeature', 'health.noBase', 'health.unresolved', 'health.duplicates',
  'ai.accepted', 'ai.edited', 'ai.refused', 'ai.staticShare', 'ai.preferred', 'fixes.typed', 'memory.effect',
]));
export const METRIC_GROUPS = Object.freeze(/** @type {MetricGroup[]} */ (['coverage', 'health', 'ai', 'fixes', 'memory']));

export { assertMemoryRecord, assertMemoryExport };

// ---------------------------------------------------------------------------------------------
// Shape checks. Each refusal is one sentence: "<where> must <what>."
const fail = (where, what) => { throw new TypeError(`${where} must ${what}.`); };
const str = (v, where) => { if (typeof v !== 'string' || v.length === 0) fail(where, 'be a non-empty string'); };
const strs = (v, where) => { if (!Array.isArray(v)) fail(where, 'be a list'); v.forEach((x, i) => str(x, `${where} ${i}`)); };
const sentence = (v, where) => { str(v, where); if (!/[.?!]$/.test(v)) fail(where, 'be a full sentence'); };

/**
 * Throw a one-sentence TypeError unless `r` is a GraphRead.
 * @param {any} r
 * @returns {asserts r is GraphRead}
 */
export function assertGraphRead(r) {
  if (!r || r.ok !== true) fail('The graph read', 'be {ok: true, ...}');
  if (!r.graph || !Array.isArray(r.graph.nodes) || !Array.isArray(r.graph.edges)) fail("The graph read's graph", 'have nodes and edges');
  sentence(r.sentence, "The graph read's sentence");
  if (r.focus !== undefined) {
    str(r.focus.id, "The graph read's focus id");
    strs(r.focus.whoCalls, "The graph read's whoCalls");
    strs(r.focus.impactOf, "The graph read's impactOf");
  }
}

/**
 * Throw a one-sentence TypeError unless `v` is a MemoryRecordsView (each record checked by im3's assertMemoryRecord).
 * @param {any} v
 * @returns {asserts v is MemoryRecordsView}
 */
export function assertMemoryRecordsView(v) {
  if (!v || v.ok !== true) fail('The memory records view', 'be {ok: true, ...}');
  if (v.step !== null) str(v.step, "The memory records view's step");
  if (!Array.isArray(v.records)) fail("The memory records view's records", 'be a list');
  v.records.forEach((r) => assertMemoryRecord(r));
  if (!v.embeddings || typeof v.embeddings.on !== 'boolean' || v.embeddings.covers !== 'slotted-text') fail("The memory records view's embeddings", 'be {on: boolean, covers: "slotted-text"}');
  if (!Array.isArray(v.log)) fail("The memory records view's log", 'be a list');
  v.log.forEach((e, i) => {
    if (e.by !== 'person') fail(`Memory log entry ${i}'s by`, 'be person');
    if (!MEMORY_ACTIONS.includes(e.action)) fail(`Memory log entry ${i}'s action`, `be one of ${MEMORY_ACTIONS.join(', ')}`);
    str(e.target, `Memory log entry ${i}'s target`);
    str(e.at, `Memory log entry ${i}'s at`);
  });
  sentence(v.sentence, "The memory records view's sentence");
}

/**
 * Throw a one-sentence TypeError unless `v` is a ChangeView whose every step calls its kind's plan tool.
 * @param {any} v
 * @returns {asserts v is ChangeView}
 */
export function assertChangeView(v) {
  if (!v || v.ok !== true || !Array.isArray(v.proposals)) fail('The change view', 'be {ok: true, proposals}');
  v.proposals.forEach((p, i) => {
    const w = `Change proposal ${i}`;
    str(p.id, `${w}'s id`);
    if (!CHANGE_KINDS.includes(p.kind)) fail(`${w}'s kind`, `be one of ${CHANGE_KINDS.join(', ')}`);
    str(p.target, `${w}'s target`);
    sentence(p.sentence, `${w}'s sentence`);
    if (!p.step || p.step.tool !== CHANGE_TOOL[/** @type {ChangeKind} */ (p.kind)]) fail(`${w}'s step`, `call ${CHANGE_TOOL[/** @type {ChangeKind} */ (p.kind)]}`);
    if (!p.step.args || typeof p.step.args !== 'object') fail(`${w}'s step args`, 'be an object');
    strs(p.details, `${w}'s details`);
  });
  sentence(v.sentence, "The change view's sentence");
}

/**
 * Throw a one-sentence TypeError unless `v` is a SmartView (known metric ids, once each, shares from 0 to 1).
 * @param {any} v
 * @returns {asserts v is SmartView}
 */
export function assertSmartView(v) {
  if (!v || v.ok !== true || v.local !== true || !Array.isArray(v.metrics)) fail('The smart view', 'be {ok: true, local: true, metrics}');
  const seen = new Set();
  v.metrics.forEach((m, i) => {
    const w = `Metric ${i}`;
    if (!METRIC_IDS.includes(m.id)) fail(`${w}'s id`, `be one of ${METRIC_IDS.join(', ')}`);
    if (seen.has(m.id)) fail(`${w}'s id ${m.id}`, 'appear once');
    seen.add(m.id);
    if (!METRIC_GROUPS.includes(m.group) || !m.id.startsWith(`${m.group}.`)) fail(`${w}'s group`, `be the first part of its id (${m.id})`);
    str(m.label, `${w}'s label`);
    if (m.value !== null && (typeof m.value !== 'number' || m.value < 0 || m.value > 1)) fail(`${w}'s value`, 'be a share from 0 to 1, or null');
    if (!Array.isArray(m.trend)) fail(`${w}'s trend`, 'be a list');
    sentence(m.improve, `${w}'s improve`);
    strs(m.items, `${w}'s items`);
    if (m.open !== 'map' && m.open !== 'plan') fail(`${w}'s open`, 'be map or plan');
    strs(m.details, `${w}'s details`);
  });
  sentence(v.sentence, "The smart view's sentence");
}
