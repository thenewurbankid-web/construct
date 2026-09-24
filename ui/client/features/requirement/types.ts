// The requirement chain (#642): the view models the controller hands to the presentation-only components
// (COMPONENT-003: a component gets props, never application logic), so everything a component shows is already a
// string or a flag. Server shapes and the screen state are domain/RequirementTypes.ts.
import type { Example } from './domain/Examples';
import type { PlacementKind, TimelineStep } from './domain/RequirementTypes';

export type CardNounView = { id: string; text: string; kind: string; kindLabel: string; properties: string };
export type CardVerbView = { id: string; text: string; kind: string; kindLabel: string; acts: string };
export type CardCheckView = { id: string; name: string; from: string; why: string };
export type CardView = { counts: string; nouns: CardNounView[]; verbs: CardVerbView[]; checks: CardCheckView[] };

export type OpenOptionView = { id: string; label: string; why: string };
export type OpenView = { id: string; question: string; source: 'card' | 'placement'; options: OpenOptionView[] };

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

export type ResultView = {
  card: CardView;
  open: OpenView[];
  /** null while a word of the card is open: nothing is placed until a person answers. */
  blocks: BlockView[] | null;
  notes: string[];
  errors: string[];
  warnings: string[];
  timeline: TimelineStep[];
  /** Every file the plan will create, once each. */
  files: string[];
  approve: ApproveView;
};

export type RequirementView = { text: string; busy: boolean; canRead: boolean; error: string | null; result: ResultView | null; examples: Example[] };

export type SentenceFormProps = { view: RequirementView; onText: (text: string) => void; onExample: (text: string) => void; onRead: () => void };
export type CardPanelProps = { card: CardView };
export type OpenQuestionsProps = { open: OpenView[]; busy: boolean; onAnswer: (question: OpenView, option: string) => void };
export type PlacementPanelProps = { blocks: BlockView[]; notes: string[]; errors: string[] };
export type TimelinePanelProps = { steps: TimelineStep[] };
export type ApproveBarProps = { approve: ApproveView; warnings: string[]; files: string[]; onApprove: () => void; onSaveNote: () => void; onOpenProcesses: () => void };
export type RequirementPageProps = {
  view: RequirementView;
  onText: (text: string) => void;
  onExample: (text: string) => void;
  onRead: () => void;
  onAnswer: (question: OpenView, option: string) => void;
  onApprove: () => void;
  onSaveNote: () => void;
  onOpenProcesses: () => void;
};
