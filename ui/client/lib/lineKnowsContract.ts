// "What Line knows": the client's mirror of the page's server contract (packages/engine/line/knows/contract.mjs, the
// graph's packages/engine/line/graph/contract.mjs and im3's packages/engine/line/memory/contract.mjs), plus the view
// models of the four tabs. Each tab lives in its own feature folder (line-knows-map, line-knows-memory,
// line-knows-change, line-knows-smart) and takes a KnowsTabProps; the shell (line-knows) owns the tabs and the chat.
import type { LineRefusal, PlanStepRequest } from './lineContract';

// ------------------------------------------------------------------------------------------------ wire: the graph
export type GraphNodeKind = 'item' | 'unit' | 'feature' | 'library' | 'route' | 'endpoint' | 'field' | 'table' | 'specPoint' | 'finding' | 'planStep';
export type GraphLayer = 'structure' | 'static' | 'domain' | 'process' | 'runtime';
export type GraphEdgeType =
  | 'IMPORTS' | 'BASED_ON' | 'IN_FEATURE' | 'IN_LIBRARY' | 'PART_OF'
  | 'CALLS' | 'RENDERS' | 'USES_HOOK' | 'HANDLES_EVENT'
  | 'READS_FIELD' | 'WRITES_FIELD' | 'SERVES' | 'MAPS_TO'
  | 'COVERS' | 'FLAGS' | 'CHANGES'
  | 'CALLED_AT_RUNTIME';
export type GraphNode = { id: string; kind: GraphNodeKind; label: string; file?: string; line?: number; hash: string; attrs?: Record<string, string | string[]> };
export type GraphEvidence = { file: string; line: number } | { test: string; count?: number };
export type GraphEdge = { from: string; to: string; type: GraphEdgeType; layer: GraphLayer; evidence: GraphEvidence };
export type LineGraph = { nodes: GraphNode[]; edges: GraphEdge[]; index: { version: 1; files: Record<string, string>; counts: { nodes: number; edges: number; byKind: Record<string, number>; byLayer: Record<string, number>; byType: Record<string, number> } } };
/** GET /api/line/graph?focus=<node id>. */
export type GraphRead = { ok: true; graph: LineGraph; sentence: string; focus?: { id: string; whoCalls: string[]; impactOf: string[] } };

// ------------------------------------------------------------------------------------------------ wire: memory (im3)
export type MemoryOutcomeKind = 'picked' | 'approved' | 'refused' | 'edited' | 'skipped' | 'reordered' | 'fix-picked' | 'agreed' | 'disagreed';
/** One stored record of im3's memory (slotted, never code). */
export type MemoryRecord = {
  v: 1; id: string; step: string; at: string; intent: string; structure: string | null; slots: string[]; neighbourhood: string[];
  options: string[]; proposed: string | null; kind: MemoryOutcomeKind; chosen: string | null; by: 'person' | 'agent' | 'line'; agreed: boolean;
};
export type MemoryExport = { v: 1; kind: 'line-memory'; steps: Record<string, MemoryRecord[]> };
/** im3's GET /api/line/memory. */
export type MemoryStepsView = { ok: true; steps: { step: string; label: string; size: number }[]; total: number; sentence: string };
export type MemoryAction = 'edit' | 'forget' | 'forgetStep' | 'forgetAll' | 'import' | 'embeddings';
export type MemoryLogEntry = { at: string; by: 'person'; action: MemoryAction; target: string };
/** GET /api/line/memory/records?step= (and every memory write's answer). */
export type MemoryRecordsView = { ok: true; step: string | null; records: MemoryRecord[]; embeddings: { on: boolean; covers: 'slotted-text'; runs?: boolean }; log: MemoryLogEntry[]; sentence: string };

// ------------------------------------------------------------------------------------------------ wire: change, stats
export type ChangeKind = 'rebase' | 'promote' | 'removeCrossUse';
/** A typed fix the Map proposes; `step` is the plan step it becomes (line.setBase, line.promote, line.fix). */
export type ChangeProposal = { id: string; kind: ChangeKind; target: string; sentence: string; finding?: string; step: PlanStepRequest & { args: Record<string, unknown> }; details: string[] };
export type ChangeView = { ok: true; proposals: ChangeProposal[]; sentence: string };
export type MetricId =
  | 'coverage.tested' | 'coverage.runtime' | 'health.crossFeature' | 'health.noBase' | 'health.unresolved' | 'health.duplicates'
  | 'ai.accepted' | 'ai.edited' | 'ai.refused' | 'ai.staticShare' | 'ai.preferred' | 'fixes.typed' | 'memory.effect';
export type MetricGroup = 'coverage' | 'health' | 'ai' | 'fixes' | 'memory';
export type Metric = { id: MetricId; group: MetricGroup; label: string; value: number | null; count?: number; trend: (number | null)[]; improve: string; items: string[]; open: 'map' | 'plan'; details: string[]; empty?: string; itemLabels?: Record<string, string> };
export type SmartView = { ok: true; metrics: Metric[]; sentence: string; local: true };

/** The page's routes (lib/lineKnowsHttp.ts; mock mode answers from the engine's knows/mock.mjs). */
export type KnowsHttp = {
  graph: (focus?: string) => Promise<GraphRead | LineRefusal>;
  changes: (focus?: string) => Promise<ChangeView | LineRefusal>;
  stats: () => Promise<SmartView | LineRefusal>;
  memorySteps: () => Promise<MemoryStepsView | LineRefusal>;
  memoryRecords: (step?: string) => Promise<MemoryRecordsView | LineRefusal>;
  memoryEdit: (id: string, chosen: string) => Promise<MemoryRecordsView | LineRefusal>;
  memoryForgetStep: (step: string) => Promise<MemoryStepsView | LineRefusal>;
  memoryForgetRecord: (id: string) => Promise<MemoryRecordsView | LineRefusal>;
  memoryForgetAll: () => Promise<MemoryRecordsView | LineRefusal>;
  memoryExport: () => Promise<MemoryExport | LineRefusal>;
  memoryImport: (file: MemoryExport) => Promise<MemoryRecordsView | LineRefusal>;
  memoryEmbeddings: (on: boolean) => Promise<MemoryRecordsView | LineRefusal>;
  /** Mock mode only: a change approved in the Plan lands, so its finding leaves the mock graph. */
  mockApplied?: (changeId: string) => void;
};

// ------------------------------------------------------------------------------------------------ the page's view models
export type KnowsTabId = 'map' | 'memory' | 'change' | 'smart';
export type KnowsTab = { id: KnowsTabId; label: string; sentence: string };
/** What every tab gets from the shell: the page's http, where the person stands, and how to move between tabs (a
 * number's click goes to Map with its items, a Map item's "Change it" goes to Change for that item). */
export type KnowsTabProps = {
  http: KnowsHttp;
  focus: string | null;
  onFocus: (nodeId: string | null) => void;
  goTo: (tab: KnowsTabId, focus?: string | null) => void;
  /** Mock mode is on (the tab may say so). */
  mock: boolean;
};

// Map
/** A node placed by dagre (centre x, y; width, height), with the words a person reads. */
export type PlacedNode = { id: string; label: string; kind: GraphNodeKind; area: 'library' | 'feature' | 'other'; x: number; y: number; width: number; height: number; focus: boolean; flagged: boolean };
export type PlacedEdge = { from: string; to: string; type: GraphEdgeType; layer: GraphLayer; points: { x: number; y: number }[]; bad: boolean };
export type MapPicture = { nodes: PlacedNode[]; edges: PlacedEdge[]; width: number; height: number };
/** One neighbour as a sentence ("OrdersPage is based on ListPage."); `bad` marks a rule it breaks. */
export type NeighbourSentence = { id: string; text: string; other: string; layer: GraphLayer; bad: boolean; details: string[] };
/** Something the person knows to start from: a feature, a page or a component. */
export type StartItem = { id: string; name: string; text: string; group: 'feature' | 'page' | 'component' | 'workflow' | 'library' };
export type LayerFilter = { layer: GraphLayer; label: string; on: boolean; count: number };
export type ItemRef = { id: string; name: string; text: string };
export type MapTabView = {
  sentence: string;
  start: StartItem[];
  focus: { id: string; name: string; text: string } | null;
  layers: LayerFilter[];
  sentences: NeighbourSentence[];
  picture: MapPicture;
  whoUses: ItemRef[] | null;
  breaks: ItemRef[] | null;
};

// Memory
/** One record as the Memory tab shows it: what Line saw (intent), what you did (outcome), how often, when. */
export type MemoryRow = { id: string; step: string; stepLabel: string; intent: string; outcome: string; count: number; when: string; options: string[]; chosen: string | null };
/** `summaries`: one sentence per decision made the same way ("You picked 'via the library' 3 times for 'use item'."). */
export type MemoryTabView = { sentence: string; rows: MemoryRow[]; steps: { step: string; label: string; size: number }[]; embeddingsOn: boolean; embeddingsRuns: boolean; log: string[]; summaries: { step: string; text: string; count: number }[] };

// Change
export type ChangeState = 'proposed' | 'waiting' | 'done' | 'refused';
export type ChangeCard = { id: string; kind: ChangeKind; kindLabel: string; sentence: string; target: string; state: ChangeState; stateSentence: string | null; stepId: string | null; details: string[] };
export type ChangeTabView = { sentence: string; cards: ChangeCard[] };

// How smart is it
/** One item behind a number that opens on the Map: its readable label, and the id's tail (a unit's hash) as secondary text when it differs. */
export type MetricItemRow = { id: string; label: string; secondary?: string };
export type MetricCard = { id: MetricId; group: MetricGroup; groupLabel: string; label: string; display: string; trend: string; trendDirection: 'up' | 'down' | 'flat' | 'none'; improve: string; items: string[]; open: 'map' | 'plan'; details: string[]; empty?: string; itemRows: MetricItemRow[] };
export type SmartTabView = { sentence: string; groups: { group: MetricGroup; label: string; cards: MetricCard[] }[] };
