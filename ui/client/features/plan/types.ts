// Plan mode (#289, #332): the shapes every layer shares. These are the view models the controller hands to the
// presentation-only components (COMPONENT-003: a component gets props, never application logic), so everything a
// component shows is already a string or a flag. Server shapes and the screen state are domain/PlanTypes.ts.

export type Executor = 'deterministic' | 'local-model' | 'user';
export type Provenance = 'derived' | 'inferred';
export type Status = 'idle' | 'loading' | 'ready' | 'failed';
export type Ticket = { title: string; body: string };


export type ImpactRow = { key: string; cells: string[]; provenance: Provenance; path?: string };
export type ImpactWarningView = { key: string; title: string; provenance: Provenance; message: string };
export type ImpactView = {
  headline: string;
  seedNote: string;
  counts: string;
  warnings: ImpactWarningView[];
  features: ImpactRow[];
  files: ImpactRow[];
  truncated: boolean;
};

export type ImpactPaneProps = {
  status: Status;
  error: string | null;
  view: ImpactView | null;
};

export type TagView = { id: Executor; label: string; hint: string; pressed: boolean };
export type ArgView = { name: string; label: string; enum: string[] | null; description: string | null; value: string };
export type ErrorView = { key: string; code: string; lead: string; plain: string };

export type StepView = {
  id: string;
  flow: string;
  title: string;
  executor: Executor;
  executorLabel: string;
  tags: TagView[];
  args: ArgView[];
  hasObjectArg: boolean;
  touches: string;
  command: string | null;
  manual: boolean;
  model: boolean;
  errors: ErrorView[];
};

export type StepCardProps = {
  view: StepView;
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onRetag: (e: Executor) => void;
  onArg: (name: string, value: string) => void;
  onTitle: (title: string) => void;
};

export type TicketFieldsProps = {
  ticket: Ticket;
  onTicket: (t: Partial<Ticket>) => void;
};

export type ProposalView = { ref: string; badge: string; why: string };
export type ConstraintsView = { summary: string; rules: { id: string; severity: string }[] };
export type ConstraintsProps = { constraints: ConstraintsView | null };

export type UnitPickerProps = {
  features: { ref: string; name: string }[];
  picked: string[];
  onTogglePick: (ref: string) => void;
  proposals: ProposalView[] | null;
  proposalsBusy: boolean;
  proposalsError: string | null;
  accepted: string[];
  onToggleAccept: (ref: string) => void;
  onPropose: () => void;
  canPropose: boolean;
};

/** The durable note's state as the ticket pane shows it (#609): one line of text, and only the actions that apply. */
export type NoteStatusView = {
  kind: 'none' | 'saving' | 'saved' | 'failed' | 'conflict' | 'ran';
  label: string;
  /** "Plan out of date": the text changed after the plan was saved. */
  planStale: boolean;
  canRetry: boolean;
  canResolve: boolean;
};

export type NoteStatusHandlers = { onRetry: () => void; onLoadTheirs: () => void; onKeepMine: () => void; onKeepPlan: () => void };

export type TicketPaneProps = TicketFieldsProps &
  NoteStatusHandlers &
  { noteStatus: NoteStatusView } &
  ConstraintsProps &
  UnitPickerProps & {
    onAnalyse: () => void;
    analyseBusy: boolean;
    canAnalyse: boolean;
  };

export type CatalogueProps = {
  flows: { id: string; label: string }[];
  suggestionCount: number;
  onAdd: (flow: string) => void;
  onAddSuggested: () => void;
};

export type RunBarProps = {
  modelNotice: string | null;
  blocked: string | null;
  canRun: boolean;
  runStatus: Status;
  runError: string | null;
  started: boolean;
  onRun: () => void;
  onOpenProcesses: () => void;
};

export type PlanPaneProps = {
  count: number;
  steps: { view: StepView }[];
  planErrors: ErrorView[];
  catalogue: CatalogueProps;
  run: RunBarProps;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onRetag: (id: string, e: Executor) => void;
  onArg: (id: string, name: string, value: string) => void;
  onTitle: (id: string, title: string) => void;
};

/** What the controller wires into the plan pane. */
export type PlanHandlers = Pick<PlanPaneProps, 'onMove' | 'onRemove' | 'onRetag' | 'onArg' | 'onTitle'> & {
  onAdd: (flow: string) => void;
  onAddSuggested: () => void;
  onRun: () => void;
  onOpenProcesses: () => void;
};

/** What the controller wires into the ticket pane. */
export type TicketHandlers = Pick<TicketPaneProps, 'onTicket' | 'onTogglePick' | 'onToggleAccept' | 'onPropose' | 'onAnalyse'> & NoteStatusHandlers;
