// The requirement chain (#642): the view models the controller hands to the presentation-only components
// (COMPONENT-003: a component gets props, never application logic), so everything a component shows is already a
// string or a flag. Server shapes and the screen state are domain/RequirementTypes.ts.
import type { Example } from './domain/Examples';
import type { PlacementKind, ProofState, TimelineStep } from './domain/RequirementTypes';

export type CardNounView = { id: string; text: string; kind: string; kindLabel: string; properties: string };
export type CardVerbView = { id: string; text: string; kind: string; kindLabel: string; acts: string };
export type CardCheckView = { id: string; name: string; from: string; why: string };
export type CardView = { counts: string; nouns: CardNounView[]; verbs: CardVerbView[]; checks: CardCheckView[] };

/** The decision provider's suggestion for one question (#633): the option, "suggested by rules" and its reason. Suggest-only. */
export type SuggestionView = { option: string; label: string; reason: string };

export type OpenOptionView = { id: string; label: string; why: string; suggested: boolean };
export type OpenView = { id: string; question: string; source: 'card' | 'placement'; options: OpenOptionView[]; suggestion: SuggestionView | null };

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
  suggestion: SuggestionView | null;
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
  /** A symbol beside the heading, so the kind is never only a colour. */
  symbol: string;
  heading: string;
  summary: string;
  /** Short facts, each with a stable id ("failing-state": "Failing state: empty, the screen reached blank"). */
  facts: { id: string; text: string }[];
  /** What the proof said, as text (a harness problem or a run that could not finish); null for an app failure. */
  message: string | null;
  notes: string[];
};
/** A line above the actions: the counts of the last run, the run in progress, or why it could not run. */
export type ProofNoticeView = { id: 'counts' | 'running' | 'error'; tone: 'muted' | 'error'; role: 'status' | 'alert' | undefined; text: string };
/** One button: run first, then the closed options of the server's summary. `action` 'off' shows what it will do and stays off. */
export type ProofButtonView = { id: string; testId: string; label: string; variant: 'primary' | 'ghost'; action: 'run' | 'skip' | 'off'; disabled: boolean; why: string };
/** What an option that is not wired yet will do, and why it is off. */
export type ProofNoteView = { id: string; text: string };
export type ProofSkipView = { open: boolean; saving: boolean; draft: string; error: string | null; invalid: boolean; hint: string; max: number; confirmLabel: string };
/** The Proof card (#653): the state of the proof of a generated screen, the chain summary, and what can be done next. */
export type ProofView = {
  feature: string;
  screen: string;
  state: ProofState;
  symbol: string;
  stateLabel: string;
  headline: string;
  /** "complete (proof green: 10 passed)", "complete (proof skipped: <reason>)" or "incomplete (...)": never a plain "complete". */
  chain: { complete: boolean; line: string };
  notices: ProofNoticeView[];
  failures: ProofFailureView[];
  buttons: ProofButtonView[];
  notes: ProofNoteView[];
  /** Why the proof cannot be run yet ("Approve the plan first..."), or null. */
  runReason: string | null;
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
export type OpenQuestionProps = { q: OpenView; busy: boolean; onAnswer: (question: AnswerTarget, option: string) => void };
export type ShapeOptionProps = { offer: OfferView; option: OfferOptionView; busy: boolean; onAnswer: (question: AnswerTarget, option: string) => void };
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
