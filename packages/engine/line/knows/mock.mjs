// "What Line knows", the contract's mock (contract.mjs): the Line sample's graph as G1 builds it (examples/line-sample,
// trimmed to its items, features, routes, findings, spec points and two logic units), memory records per AI step, the
// typed changes the Map proposes and the numbers of "How smart is it". Pure data and pure functions, no Node imports:
// the server's tests and the Cockpit's mock mode (?line=mock) both use it. Every value passes its assert* in
// contract.mjs and graph/contract.mjs.
import { countGraph, GRAPH_VERSION } from '../graph/contract.mjs';
import { queryGraph } from '../graph/query.mjs';

/** @typedef {import('../graph/contract.mjs').GraphNode} GraphNode */
/** @typedef {import('../graph/contract.mjs').GraphEdge} GraphEdge */
/** @typedef {import('../graph/contract.mjs').LineGraph} LineGraph */
/** @typedef {import('../memory/contract.mjs').MemoryRecord} MemoryRecord */
/** @typedef {import('../memory/contract.mjs').MemoryExport} MemoryExport */
/** @typedef {import('./contract.mjs').MemoryRecordsView} MemoryRecordsView */
/** @typedef {import('./contract.mjs').MemoryLogEntry} MemoryLogEntry */
/** @typedef {import('./contract.mjs').ChangeView} ChangeView */
/** @typedef {import('./contract.mjs').SmartView} SmartView */
/** @typedef {import('./contract.mjs').GraphRead} GraphRead */

let seq = 0;
const h = () => { seq += 1; return `sha256:${seq.toString(16).padStart(16, '0')}`; };
const FEAT = (name) => /** @type {GraphNode} */ ({ id: `feature:${name}`, kind: 'feature', label: name, file: `features/${name}/spec.md`, hash: h() });
/** A library item. */
const LIB = (kind, name, ext = 'tsx', extra = {}) => /** @type {GraphNode} */ ({ id: `item:library/${kind}/${name}`, kind: 'item', label: name, file: `library/${kind}/${name}.${ext}`, line: 1, hash: h(), attrs: { area: 'library', itemKind: kind, ...extra } });
/** A feature item. */
const ITEM = (feature, kind, name, ext = 'tsx', layers = ['component']) => /** @type {GraphNode} */ ({ id: `item:${feature}/${kind}/${name}`, kind: 'item', label: name, file: `features/${feature}/${kind}/${name}.${ext}`, line: 1, hash: h(), attrs: { area: 'feature', feature, itemKind: kind, layers } });
const fileOf = (id) => /** @type {string} */ (nodes.find((n) => n.id === id)?.file);
/** An edge whose evidence is in the `from` node's file at `line`. */
const E = (from, type, to, line = 1, layer = LAYER[type]) => /** @type {GraphEdge} */ ({ from, to, type, layer, evidence: { file: fileOf(from) ?? 'features/orders/spec.md', line } });
const LAYER = /** @type {Record<string, any>} */ ({ IMPORTS: 'structure', BASED_ON: 'structure', IN_FEATURE: 'structure', IN_LIBRARY: 'structure', PART_OF: 'structure', CALLS: 'static', RENDERS: 'static', HANDLES_EVENT: 'static', USES_HOOK: 'static', COVERS: 'process', FLAGS: 'process' });

/** @type {GraphNode[]} */
const nodes = [
  { id: 'library', kind: 'library', label: 'library', hash: h() },
  FEAT('billing'), FEAT('orders'),
  LIB('components', 'Badge', 'tsx', { level: 'atom', layers: ['component'] }),
  LIB('components', 'Button', 'tsx', { level: 'atom', layers: ['component'] }),
  LIB('components', 'Card', 'tsx', { level: 'molecule', layers: ['component'] }),
  LIB('components', 'DataTable', 'tsx', { level: 'organism', layers: ['component'] }),
  LIB('pages', 'ListPage', 'tsx', { layers: ['component'] }),
  LIB('workflows', 'checkout', 'ts', { layers: ['domain'] }),
  ITEM('billing', 'components', 'InvoiceCard'),
  ITEM('billing', 'pages', 'InvoicesPage'),
  ITEM('orders', 'components', 'OrderButton'),
  ITEM('orders', 'components', 'OrderCard'),
  ITEM('orders', 'pages', 'OrdersPage'),
  ITEM('orders', 'workflows', 'orderCheckout', 'ts', ['domain']),
  { id: 'route:/billing', kind: 'route', label: '/billing', hash: h() },
  { id: 'route:/orders', kind: 'route', label: '/orders', hash: h() },
  { id: 'unit:6fad22416fa70dad', kind: 'unit', label: 'handler in OrdersPage', file: 'features/orders/pages/OrdersPage.tsx', line: 6, hash: h(), attrs: { unitKind: 'handler' } },
  { id: 'unit:28f4fe2e81302a5a', kind: 'unit', label: 'handler in ListPage', file: 'library/pages/ListPage.tsx', line: 7, hash: h(), attrs: { unitKind: 'handler' } },
  { id: 'spec:orders#1', kind: 'specPoint', label: 'The OrdersPage lists every order with its status.', file: 'features/orders/spec.md', line: 5, hash: h() },
  { id: 'spec:billing#1', kind: 'specPoint', label: 'A user sees their invoices.', file: 'features/billing/spec.md', line: 5, hash: h() },
  { id: 'finding:LINE-DIR|features/billing/pages/InvoicesPage.tsx|4', kind: 'finding', label: 'Feature "billing" imports OrderButton from feature "orders", and a feature may use only the library.', file: 'features/billing/pages/InvoicesPage.tsx', line: 4, hash: h(), attrs: { rule: 'LINE-DIR', severity: 'error' } },
  { id: 'finding:LINE-BASE|features/billing/components/InvoiceCard.tsx|1', kind: 'finding', label: 'The feature component InvoiceCard has no library base.', file: 'features/billing/components/InvoiceCard.tsx', line: 1, hash: h(), attrs: { rule: 'LINE-BASE', severity: 'error' } },
];

const I = (s) => `item:${s}`;
/** @type {GraphEdge[]} */
const edges = [
  E(I('billing/components/InvoiceCard'), 'IN_FEATURE', 'feature:billing'),
  E(I('billing/components/InvoiceCard'), 'IMPORTS', I('library/components/Card')),
  E(I('billing/components/InvoiceCard'), 'RENDERS', I('library/components/Card'), 4),
  E(I('billing/pages/InvoicesPage'), 'IN_FEATURE', 'feature:billing'),
  E(I('billing/pages/InvoicesPage'), 'BASED_ON', I('library/pages/ListPage')),
  E(I('billing/pages/InvoicesPage'), 'IMPORTS', I('library/pages/ListPage'), 3),
  E(I('billing/pages/InvoicesPage'), 'IMPORTS', I('orders/components/OrderButton'), 4),
  E(I('billing/pages/InvoicesPage'), 'PART_OF', 'route:/billing', 2),
  E(I('billing/pages/InvoicesPage'), 'RENDERS', I('library/pages/ListPage'), 9),
  E(I('billing/pages/InvoicesPage'), 'RENDERS', I('orders/components/OrderButton'), 10),
  ...['Badge', 'Button', 'Card', 'DataTable'].map((n) => E(I(`library/components/${n}`), 'IN_LIBRARY', 'library')),
  E(I('library/pages/ListPage'), 'IN_LIBRARY', 'library'),
  E(I('library/workflows/checkout'), 'IN_LIBRARY', 'library'),
  E(I('library/components/Card'), 'IMPORTS', I('library/components/Button')),
  E(I('library/components/Card'), 'RENDERS', I('library/components/Button'), 7),
  E(I('library/components/DataTable'), 'IMPORTS', I('library/components/Badge')),
  E(I('library/components/DataTable'), 'IMPORTS', I('library/components/Card'), 2),
  E(I('library/components/DataTable'), 'RENDERS', I('library/components/Badge'), 8),
  E(I('library/components/DataTable'), 'RENDERS', I('library/components/Card'), 7),
  E(I('library/pages/ListPage'), 'IMPORTS', I('library/components/Button')),
  E(I('library/pages/ListPage'), 'RENDERS', I('library/components/Button'), 7),
  E(I('orders/components/OrderButton'), 'IN_FEATURE', 'feature:orders'),
  E(I('orders/components/OrderButton'), 'BASED_ON', I('library/components/Button')),
  E(I('orders/components/OrderButton'), 'IMPORTS', I('library/components/Button'), 2),
  E(I('orders/components/OrderButton'), 'RENDERS', I('library/components/Button'), 5),
  E(I('orders/components/OrderCard'), 'IN_FEATURE', 'feature:orders'),
  E(I('orders/components/OrderCard'), 'BASED_ON', I('library/components/Card')),
  E(I('orders/components/OrderCard'), 'IMPORTS', I('library/components/Card'), 2),
  E(I('orders/components/OrderCard'), 'RENDERS', I('library/components/Card'), 5),
  E(I('orders/pages/OrdersPage'), 'IN_FEATURE', 'feature:orders'),
  E(I('orders/pages/OrdersPage'), 'BASED_ON', I('library/pages/ListPage')),
  E(I('orders/pages/OrdersPage'), 'IMPORTS', I('library/pages/ListPage'), 3),
  E(I('orders/pages/OrdersPage'), 'PART_OF', 'route:/orders', 2),
  E(I('orders/pages/OrdersPage'), 'RENDERS', I('library/pages/ListPage'), 6),
  E(I('orders/pages/OrdersPage'), 'HANDLES_EVENT', I('library/pages/ListPage'), 6),
  E(I('orders/workflows/orderCheckout'), 'IN_FEATURE', 'feature:orders'),
  E(I('orders/workflows/orderCheckout'), 'BASED_ON', I('library/workflows/checkout')),
  E(I('orders/workflows/orderCheckout'), 'IMPORTS', I('library/workflows/checkout'), 2),
  E(I('orders/workflows/orderCheckout'), 'CALLS', I('library/workflows/checkout'), 5),
  E('unit:6fad22416fa70dad', 'PART_OF', I('orders/pages/OrdersPage'), 6),
  E('unit:28f4fe2e81302a5a', 'PART_OF', I('library/pages/ListPage'), 7),
  E('spec:orders#1', 'COVERS', I('orders/pages/OrdersPage'), 5),
  E('finding:LINE-DIR|features/billing/pages/InvoicesPage.tsx|4', 'FLAGS', I('billing/pages/InvoicesPage'), 4),
  E('finding:LINE-BASE|features/billing/components/InvoiceCard.tsx|1', 'FLAGS', I('billing/components/InvoiceCard'), 1),
  { from: I('orders/pages/OrdersPage'), to: I('library/pages/ListPage'), type: 'CALLED_AT_RUNTIME', layer: 'runtime', evidence: { test: 'OrdersPage.test.tsx > lists orders', count: 2 } },
];

/** The Line sample's graph (frozen; G1's LineGraph). */
export const MOCK_KNOWS_GRAPH = /** @type {LineGraph} */ (Object.freeze({
  nodes: Object.freeze(nodes),
  edges: Object.freeze(edges),
  index: Object.freeze({ version: GRAPH_VERSION, files: Object.fromEntries(nodes.filter((n) => n.kind === 'item').map((n) => [n.file, n.hash])), counts: countGraph(nodes, edges) }),
}));

/** @type {ReadonlyArray<Readonly<MemoryRecord>>} */
export const MOCK_MEMORY_RECORDS = Object.freeze([
  ...[1, 2, 3].map((n) => rec(n, 'drafter.route', 'use.item', 'via-library:ui:I>F', ['via-library:ui:I>F', 'base-on:ui:L>F'], 'picked', `2026-10-1${n}T09:12:00.000Z`)),
  rec(4, 'drafter.route', 'add.component', 'base-on:ui:L>F', ['base-on:ui:L>F', 'via-library:ui:C>F'], 'picked', '2026-10-12T08:40:00.000Z'),
  rec(5, 'plan.fix', 'fix.finding', 'LINE-DIR:promote', ['LINE-DIR:promote', 'LINE-DIR:remove'], 'fix-picked', '2026-10-12T07:30:00.000Z'),
  rec(6, 'plan.step', 'promote.component', 'line.promote', ['line.promote'], 'approved', '2026-10-10T16:05:00.000Z'),
].map((r) => Object.freeze(r)));

/**
 * One im3 memory record (memory/contract.mjs MemoryRecord), slotted.
 * @returns {MemoryRecord}
 */
function rec(n, step, intent, chosen, options, kind, at) {
  return { v: 1, id: `m-mock${String(n).padStart(4, '0')}`, step, at, intent, structure: null, slots: ['F:feature', 'I:item kind=components'], neighbourhood: [], options, proposed: options[0], kind, chosen, by: 'person', agreed: false };
}

/** The typed changes the Map proposes for the sample (each a plan step a person approves). */
export const MOCK_CHANGE_VIEW = /** @type {ChangeView} */ (Object.freeze({
  ok: true,
  sentence: 'Line proposes 3 changes; each one waits for your approval and goes through Construct\'s writer.',
  proposals: [
    { id: 'change:promote:orders/components/OrderButton', kind: 'promote', target: I('orders/components/OrderButton'), finding: 'finding:LINE-DIR|features/billing/pages/InvoicesPage.tsx|4', sentence: 'Move OrderButton to the library, so billing can use it from there.', step: { tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } }, details: ['line.promote featureItemId=orders/components/OrderButton', 'fixes LINE-DIR features/billing/pages/InvoicesPage.tsx:4'] },
    { id: 'change:removeCrossUse:billing/pages/InvoicesPage', kind: 'removeCrossUse', target: I('billing/pages/InvoicesPage'), finding: 'finding:LINE-DIR|features/billing/pages/InvoicesPage.tsx|4', sentence: 'Stop InvoicesPage using OrderButton from feature orders.', step: { tool: 'line.fix', args: { findingKey: 'LINE-DIR|features/billing/pages/InvoicesPage.tsx|4', fixId: 'LINE-DIR/remove' } }, details: ['line.fix findingKey=LINE-DIR|features/billing/pages/InvoicesPage.tsx|4 fixId=LINE-DIR/remove'] },
    { id: 'change:rebase:billing/components/InvoiceCard', kind: 'rebase', target: I('billing/components/InvoiceCard'), finding: 'finding:LINE-BASE|features/billing/components/InvoiceCard.tsx|1', sentence: 'Base InvoiceCard on the library Card.', step: { tool: 'line.setBase', args: { file: 'features/billing/components/InvoiceCard.tsx', libraryId: 'components/Card' } }, details: ['line.setBase file=features/billing/components/InvoiceCard.tsx libraryId=components/Card', 'fixes LINE-BASE features/billing/components/InvoiceCard.tsx:1'] },
  ],
}));

/** "How smart is it" on the sample (local records only). */
export const MOCK_SMART_VIEW = /** @type {SmartView} */ (Object.freeze({
  ok: true,
  local: true,
  sentence: 'These numbers come only from records on this machine; nothing leaves it.',
  metrics: [
    { id: 'coverage.tested', group: 'coverage', label: 'Logic units with a test', value: 0.5, count: 2, trend: [0.25, 0.4, 0.5], improve: 'Add a behaviour test for the units listed here, starting with the handlers.', items: ['unit:28f4fe2e81302a5a'], open: 'map', details: ['1 of 2 units has a test'] },
    { id: 'coverage.runtime', group: 'coverage', label: 'Logic units reached at runtime', value: 0.5, count: 2, trend: [0, 0.5], improve: 'Run the tests with the runtime recorder so Line sees which units really ran.', items: ['unit:28f4fe2e81302a5a'], open: 'map', details: ['runtimeCoverage: 1 of 2 logic units ran in a test'] },
    { id: 'health.crossFeature', group: 'health', label: 'Cross-feature uses', value: null, count: 1, trend: [2, 1], improve: 'Move what two features share into the library.', items: ['item:billing/pages/InvoicesPage'], open: 'map', details: ['LINE-DIR features/billing/pages/InvoicesPage.tsx:4'] },
    { id: 'health.noBase', group: 'health', label: 'Items with no base', value: null, count: 1, trend: [1, 1], improve: 'Base each feature item on one library item.', items: ['item:billing/components/InvoiceCard'], open: 'map', details: ['LINE-BASE features/billing/components/InvoiceCard.tsx:1'] },
    { id: 'health.unresolved', group: 'health', label: 'Unresolved imports', value: null, count: 0, trend: [0, 0], improve: 'Nothing to do: every import resolves.', items: [], open: 'map', details: [] },
    { id: 'health.duplicates', group: 'health', label: 'Duplicates', value: null, count: 0, trend: [0], improve: 'Nothing to do: no two items look the same.', items: [], open: 'map', details: [] },
    { id: 'ai.accepted', group: 'ai', label: 'Proposals accepted as they were', value: 0.7, count: 10, trend: [0.5, 0.6, 0.7], improve: 'Teach Line the cases you edit most in Train Line.', items: [], open: 'plan', details: ['7 of 10 proposals'] },
    { id: 'ai.edited', group: 'ai', label: 'Proposals you edited', value: 0.2, count: 10, trend: [0.3, 0.25, 0.2], improve: 'Open the edited steps and save the right answer as a training case.', items: [], open: 'plan', details: ['2 of 10 proposals'] },
    { id: 'ai.refused', group: 'ai', label: 'Proposals refused', value: 0.1, count: 10, trend: [0.2, 0.15, 0.1], improve: 'Read the refusals; each one carries the typed fix Line will try next time.', items: [], open: 'plan', details: ['1 of 10 proposals'] },
    { id: 'ai.staticShare', group: 'ai', label: 'Decided by static rules, not a model', value: 0.8, count: 10, trend: [0.6, 0.8], improve: 'Turn repeated model decisions into rules in Train Line.', items: [], open: 'plan', details: ['8 static, 2 AI'] },
    { id: 'ai.preferred', group: 'ai', label: 'Drafter picked your preferred route', value: 0.75, count: 4, trend: [0.5, 0.75], improve: 'Pick the route you prefer when the drafter offers several; Line remembers it.', items: [], open: 'plan', details: ['3 of 4 of your picks'] },
    { id: 'fixes.typed', group: 'fixes', label: 'Refusals fixed by a typed fix, no edit by you', value: 0.67, count: 3, trend: [0.5, 0.67], improve: 'Apply the recommended fix first; edit only when it is wrong.', items: [], open: 'plan', details: ['2 of 3 refusals'] },
    { id: 'memory.effect', group: 'memory', label: 'Accuracy gained from memory', value: 0.1, count: 10, trend: [0, 0.1], improve: 'Keep memory on; forget only the records that are wrong.', items: [], open: 'plan', details: ['with memory 80%, without 70%'] },
  ],
}));

const sentenceOf = (g) => {
  const items = g.nodes.filter((n) => n.kind === 'item').length;
  return `Line knows ${items} items and ${g.edges.length} links between them.`;
};

/**
 * GET /api/line/graph over a graph: the graph, and for a focus who calls it and what a change to it may break.
 * Shared by the mock and the real route.
 * @param {LineGraph} graph
 * @param {string} [focus]
 * @returns {GraphRead}
 */
export function graphRead(graph, focus) {
  /** @type {GraphRead} */
  const out = { ok: true, graph, sentence: sentenceOf(graph) };
  if (focus) {
    const q = queryGraph(graph);
    out.focus = { id: focus, whoCalls: q.whoCalls(focus), impactOf: q.impactOf(focus) };
  }
  return out;
}

/**
 * A stateful mock of the page's server side (one per test or browser tab): the graph read, memory with its log
 * (person only), the changes and the numbers. Approving a change in mock mode removes its finding from the graph.
 * @returns The mock service.
 */
export function createMockKnows() {
  let graph = /** @type {LineGraph} */ ({ nodes: [...MOCK_KNOWS_GRAPH.nodes], edges: [...MOCK_KNOWS_GRAPH.edges], index: MOCK_KNOWS_GRAPH.index });
  let records = MOCK_MEMORY_RECORDS.map((r) => ({ ...r, slots: [...r.slots], options: [...r.options] }));
  let embeddings = false;
  /** @type {MemoryLogEntry[]} */
  const log = [];
  const logged = (action, target) => { log.push({ at: new Date().toISOString(), by: 'person', action, target }); };
  const view = (/** @type {string|null} */ step = null) => {
    const shown = records.filter((r) => step === null || r.step === step);
    return /** @type {MemoryRecordsView} */ ({ ok: true, step, records: shown.map((r) => ({ ...r })), embeddings: { on: embeddings, covers: 'slotted-text' }, log: [...log], sentence: shown.length ? `Line remembers ${shown.length} decision${shown.length === 1 ? '' : 's'} for this project, on this computer only.` : 'Line remembers nothing here yet; it learns from what you pick, approve and change.' });
  };
  const findings = () => new Set(graph.nodes.filter((n) => n.kind === 'finding').map((n) => n.id));
  return {
    graph: (/** @type {string|undefined} */ focus) => graphRead(graph, focus),
    /** im3's GET /memory: every step with its size. */
    memory: () => {
      const sizes = /** @type {Record<string, number>} */ ({});
      for (const r of records) sizes[r.step] = (sizes[r.step] ?? 0) + 1;
      const steps = Object.entries(sizes).sort().map(([step, size]) => ({ step, label: step, size }));
      return { ok: /** @type {const} */ (true), steps, total: records.length, sentence: records.length ? `Line remembers ${records.length} decisions for this project, on this computer only.` : 'Line has no memory for this project yet.' };
    },
    records: (/** @type {{step?: string}} */ a = {}) => view(a.step ?? null),
    edit: (/** @type {{id: string, chosen: string}} */ a) => {
      const r = records.find((x) => x.id === a.id);
      if (!r) return { ok: false, code: 'UNKNOWN_RECORD', sentence: 'Line does not remember that.' };
      if (!r.options.includes(a.chosen)) return { ok: false, code: 'BAD_ARGS', sentence: 'Pick one of the options Line offered for that decision.' };
      r.chosen = a.chosen;
      r.kind = 'edited';
      logged('edit', a.id);
      return view();
    },
    forgetStep: (/** @type {{step: string}} */ a) => { records = records.filter((r) => r.step !== a.step); logged('forgetStep', a.step); return view(); },
    forgetRecord: (/** @type {{id: string}} */ a) => { records = records.filter((r) => r.id !== a.id); logged('forget', a.id); return view(); },
    forgetAll: () => { records = []; logged('forgetAll', 'all'); return view(); },
    exportMemory: () => {
      /** @type {Record<string, MemoryRecord[]>} */
      const steps = {};
      for (const r of records) (steps[r.step] ??= []).push({ ...r });
      return /** @type {MemoryExport} */ ({ v: 1, kind: 'line-memory', steps });
    },
    importMemory: (/** @type {MemoryExport} */ x) => {
      const add = Object.values(x.steps ?? {}).flat().filter((r) => !records.some((m) => m.id === r.id));
      records = [...records, ...add.map((r) => ({ ...r }))];
      logged('import', `${add.length} records`);
      return view();
    },
    setEmbeddings: (/** @type {{on: boolean}} */ a) => { embeddings = a.on === true; logged('embeddings', embeddings ? 'on' : 'off'); return view(); },
    changes: () => {
      const open = findings();
      const proposals = MOCK_CHANGE_VIEW.proposals.filter((p) => !p.finding || open.has(p.finding));
      return /** @type {ChangeView} */ ({ ok: true, proposals, sentence: proposals.length ? `Line proposes ${proposals.length} change${proposals.length === 1 ? '' : 's'}; each one waits for your approval and goes through Construct's writer.` : 'Line has no change to propose.' });
    },
    /** Mock mode's approve: the change landed, so its finding leaves the graph. */
    applyChange: (/** @type {string} */ id) => {
      const p = MOCK_CHANGE_VIEW.proposals.find((x) => x.id === id);
      if (!p) return { ok: false, code: 'UNKNOWN_CHANGE', sentence: 'That change is not proposed any more.' };
      graph = { ...graph, nodes: graph.nodes.filter((n) => n.id !== p.finding), edges: graph.edges.filter((e) => e.from !== p.finding) };
      graph = { ...graph, index: { ...graph.index, counts: countGraph(graph.nodes, graph.edges) } };
      return { ok: true, sentence: `Done: ${p.sentence}` };
    },
    stats: () => MOCK_SMART_VIEW,
  };
}
