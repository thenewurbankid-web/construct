// The Workflows tab's own view models. The Line contract's shapes come from the one shared mirror (lib/lineContract.ts).
import type { LineHttp, LineWorkflow, LineWorkflowList, PlanStepRequest } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** One workflow in the feature's list. */
export type WorkflowCard = { id: string; name: string; base: string; pages: string; ok: boolean };

/** One state of the diagram, placed. */
export type DiagramNode = { id: string; label: string; sub: string; x: number; y: number; w: number; h: number; initial: boolean; final: boolean; page: boolean };
/** One arrow of the diagram: its SVG path and where its event label sits. */
export type DiagramEdge = { id: string; d: string; label: string; lx: number; ly: number; own: boolean };
export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[]; width: number; height: number; text: string[] };

/** A library workflow offered to start from: what it does, and the name the copy gets. */
export type LibraryCard = { id: string; name: string; summary: string; lines: string[]; suggested: string };

/** The When -> Do form, as typed. */
export type WhenDoDraft = { from: string; event: string; to: string; service: string; part: string; partState: string };

/** The tab's list, as loaded. */
export type ListState = { phase: 'loading' } | { phase: 'ready'; list: LineWorkflowList } | { phase: 'error'; sentence: string };

/** What adding a plan step answered (the Plan panel's addStep). */
export type StepAnswer = { ok: boolean; sentence: string; code?: string; detail?: string };
export type AddStep = (req: PlanStepRequest) => Promise<StepAnswer>;

/** The last thing the person asked for here: "Waiting for your approval: ..." or the refusal. */
export type Notice = StepAnswer | null;

/** Everything the Workflows tab renders and does (built by useLineWorkflows). */
export type LineWorkflowsView = {
  feature: string;
  state: ListState;
  cards: WorkflowCard[];
  chosen: LineWorkflow | null;
  /** The chosen workflow as a state diagram (null when none is chosen). */
  diagram: Diagram | null;
  library: LibraryCard[];
  /** The When -> Do form's start, and why a draft cannot be added yet (null when it can). */
  newDraft: WhenDoDraft;
  checkDraft: (draft: WhenDoDraft) => string | null;
  choose: (id: string) => void;
  notice: Notice;
  busy: boolean;
  startFrom: (libraryId: string, name: string) => void;
  setRole: (role: string, page: string) => void;
  addWhenDo: (draft: WhenDoDraft) => void;
  remove: (transitionId: string) => void;
  promote: () => void;
};

/** What the tab reads (the shared LINE_API mirror). */
export type LineWorkflowsApi = Pick<LineHttp, 'getWorkflows'>;
