/** Mirrors src/engine/workflowExtractor.mjs's output (served by ui/server's
 * GET /api/workflows/machines) — extracted fresh from the real source on
 * every request, never stored client-side or on disk. */
export type WorkflowState = {
  path: string;
  name: string;
  parent: string | null;
  type: string;
  initial: boolean;
  final: boolean;
  line?: number;
};

export type WorkflowTransition = {
  from: string;
  event: string;
  kind: 'on' | 'after' | 'always' | 'onDone' | 'invoke';
  target: string | null;
  rawTarget?: string;
  guard?: string;
  /** plain, unguarded, single-branch `on` entry: the only kind that can be edited visually */
  editable?: boolean;
  targetless: boolean;
  unresolved: boolean;
};

export type WorkflowMachine = {
  exportName: string | null;
  id: string;
  line?: number;
  initial: string | null;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  error: string | null;
};

export type WorkflowFileMachines = {
  feature: string;
  file: string;
  path: string;
  machines: WorkflowMachine[];
  error: string | null;
  contentHash?: string;
};

export type DiffHunk = { value: string; added?: boolean; removed?: boolean };

/** One visual edit (see src/engine/workflowEditor.mjs for the ops). */
export type WorkflowEditRequest = {
  machine: number;
  op: 'addState' | 'removeState' | 'renameState' | 'addTransition' | 'removeTransition' | 'retargetTransition';
  name?: string;
  parent?: string;
  path?: string;
  from?: string;
  event?: string;
  target?: string;
};

export type PendingWorkflowEdit = { req: WorkflowEditRequest; hunks: DiffHunk[] };

export type WorkflowsState = {
  features: string[];
  feature: string;
  files: string[];
  filesLoading: boolean;
  file: string;
  loaded: WorkflowFileMachines | null;
  error: string | null;
  pending: PendingWorkflowEdit | null;
  editBusy: boolean;
  editError: string | null;
};
