// The Components editor's view models (cu4). The Line contract's shapes come from the one shared mirror
// (lib/lineContract.ts, which follows packages/engine/line/contract.mjs and components.mjs).
import type { ComponentDiagram, LineComponentEditor, LineFix, LineHttp, LineRefusal, PlanStepRequest } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** What adding a step answers: the step's sentence, or the refusal with its code and typed fixes. */
export type StepAnswer = { ok: boolean; sentence: string; code?: string; detail?: string; fixes?: LineFix[] };
export type AddStep = (req: PlanStepRequest) => Promise<StepAnswer>;

/** The editor's three tabs. */
export type EditorTab = 'behaviour' | 'events' | 'states';

/** A refusal as the screen shows it: the sentence, the code for Details, and each typed fix as a button. */
export type RefusalView = { sentence: string; code: string | null; fixes: { id: string; label: string; step: PlanStepRequest; recommended: boolean }[] };

/** The last answer, as a notice under the editor. */
export type EditorNotice = { ok: true; sentence: string } | { ok: false; refusal: RefusalView } | null;

/** One state of a behaviour's graph, placed for drawing; `current` is the state it is in now. */
export type GraphNode = { id: string; label: string; sentence: string; x: number; y: number; w: number; h: number; initial: boolean; current: boolean };
export type GraphEdge = { id: string; d: string; label: string; lx: number; ly: number };
export type StateGraph = { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number; text: string[] };

/** The layout the graph reuses (line-workflows' workflowDiagram); injected so the domain stays pure and testable. */
export type DiagramLayout = (w: { states: ComponentDiagram['states']; transitions: ComponentDiagram['transitions']; initial: string | null }) => {
  nodes: { id: string; x: number; y: number; w: number; h: number }[];
  edges: { id: string; d: string; label: string; lx: number; ly: number }[];
  width: number;
  height: number;
};

/** The editor's load state. */
export type EditorState = { phase: 'none' } | { phase: 'loading'; file: string } | { phase: 'error'; file: string; sentence: string } | { phase: 'ready'; file: string; component: LineComponentEditor };

/** The service surface (real: GET /api/line/component; tests pass a stub). */
export type LineComponentsApi = { getComponent: LineHttp['getComponent'] };
export type ComponentRead = LineComponentEditor | LineRefusal;
