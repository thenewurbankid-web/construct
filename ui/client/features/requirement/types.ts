// The requirement chain (#642): the view models the controller hands to the presentation-only components
// (COMPONENT-003: a component gets props, never application logic), so everything a component shows is already a
// string or a flag. Server shapes and the screen state are domain/RequirementTypes.ts.
import type { Example } from './domain/Examples';
import type { PlacementKind, ProofState, TimelineStep } from './domain/RequirementTypes';

export type CardNounView = { id: string; text: string; kind: string; kindLabel: string; properties: string };
export type CardVerbView = { id: string; text: string; kind: string; kindLabel: string; acts: string };
export type CardCheckView = { id: string; name: string; from: string; why: string };
export type CardView = { counts: string; nouns: CardNounView[]; verbs: CardVerbView[]; checks: CardCheckView[] };

export type OpenOptionView = { id: string; label: string; why: string };
export type OpenView = { id: string; question: string; source: 'card' | 'placement'; options: OpenOptionView[] };

/** What a question needs to be answered: its id, and whether it is a word of the card or a placement (which replaces an earlier answer). */
export type AnswerTarget = Pick<OpenView, 'id' | 'source'>;

export type OfferOptionView = { id: string; label: string; gives: string; suggested: boolean; chosen: boolean };
/** The screen-shape offer (q-shape): a closed question that never blocks Approve. */
export type OfferView = {
  id: string;
  source: 'placement';
  question: string;
  options: OfferOptionView[];
  /** One plain line: what the plan below is right now, and who decided. */
  status: string;
  /** "person" once someone chose, else null. */
  decidedBy: string | null;
};

export type AnswerView = { question: string; answer: string; yes: boolean };
export type BlockView = { id: string; label: string; kind: PlacementKind; kindLabel: string; answers: AnswerView[]; why: string; layers: string[]; checks: string[]; files: string[] };

export type ApproveView = {
  canApprove: boolean;
  running: boolean;
  started: boolean;
  processId: string | null;
  error: string | null;
  /** Why Approve is not available yet, in words. */
  hint: string | null;
  saveState: 'idle' | 'saving' | 'saved' | 'failed';
  saveError: string | null;
};

/** One failed test of the proof as drawn, in the words of the Tests screen: the app behaved differently (a state is wrong) or a harness problem (a file is gone). */
export type ProofFailureView = {
  kind: 'app' | 'convention' | 'other';
  heading: string;
  test: string;
  summary: string;
  /** The state the proof expected, when the screen reached another: the one that is wrong ("empty"). */
  failingState: string | null;
  expected: string | null;
  reached: string | null;
  message: string | null;
  fix: string | null;
};
/** An option of the proof card. `live` options work in this slice; the others show `why` and stay off with `disabledReason`. */
export type ProofOptionView = { id: string; label: string; why: string; live: boolean; disabledReason: string | null };
export type ProofSkipView = { open: boolean; saving: boolean; draft: string; error: string | null; min: number; max: number };
/** The Proof card (#653): the state of the proof of a generated screen, the chain summary, and what can be done next. */
export type ProofView = {
  feature: string;
  screen: string;
  state: ProofState;
  symbol: string;
  stateLabel: string;
  headline: string;
  counts: string | null;
  /** "complete (proof green: 10 passed)", "complete (proof skipped: <reason>)" or "incomplete (...)": never a plain "complete". */
  chain: { complete: boolean; line: string };
  skippedReason: string | null;
  running: boolean;
  runLabel: string;
  runDisabledReason: string | null;
  canRun: boolean;
  failures: ProofFailureView[];
  runError: string | null;
  options: ProofOptionView[];
  skip: ProofSkipView;
};

export type ResultView = {
  card: CardView;
  open: OpenView[];
  offers: OfferView[];
  /** null while a word of the card is open: nothing is placed until a person answers. */
  blocks: BlockView[] | null;
  notes: string[];
  errors: string[];
  warnings: string[];
  timeline: TimelineStep[];
  /** Every file the plan will create, once each. */
  files: string[];
  approve: ApproveView;
  /** null when the plan proves nothing (no shaped unit). */
  proof: ProofView | null;
};

export type RequirementView = { text: string; busy: boolean; canRead: boolean; error: string | null; result: ResultView | null; examples: Example[] };

export type SentenceFormProps = { view: RequirementView; onText: (text: string) => void; onExample: (text: string) => void; onRead: () => void };
export type CardPanelProps = { card: CardView };
export type OpenQuestionsProps = { open: OpenView[]; busy: boolean; onAnswer: (question: AnswerTarget, option: string) => void };
export type ShapeOfferProps = { offers: OfferView[]; busy: boolean; onAnswer: (question: AnswerTarget, option: string) => void };
export type PlacementPanelProps = { blocks: BlockView[]; notes: string[]; errors: string[] };
export type TimelinePanelProps = { steps: TimelineStep[] };
export type ApproveBarProps = { approve: ApproveView; warnings: string[]; files: string[]; onApprove: () => void; onSaveNote: () => void; onOpenProcesses: () => void };
export type ProofCardProps = {
  proof: ProofView;
  onRun: () => void;
  onSkipOpen: () => void;
  onSkipDraft: (draft: string) => void;
  onSkipConfirm: () => void;
  onSkipCancel: () => void;
};
export type RequirementPageProps = {
  view: RequirementView;
  onText: (text: string) => void;
  onExample: (text: string) => void;
  onRead: () => void;
  onAnswer: (question: AnswerTarget, option: string) => void;
  onApprove: () => void;
  onSaveNote: () => void;
  onOpenProcesses: () => void;
  onProofRun: () => void;
  onProofSkipOpen: () => void;
  onProofSkipDraft: (draft: string) => void;
  onProofSkipConfirm: () => void;
  onProofSkipCancel: () => void;
};
