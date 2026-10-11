import type { LineHttp } from '@/lib/lineContract';

export type {
  ImportAgentQuestion, ImportAgentStep, ImportAgentView, ImportChange, ImportDecision, ImportFolders, ImportStepEdit, ImportVerifyCheck,
  ImportWaiting, LineRefusal,
} from '@/lib/lineContract';
import type { ImportAgentView, ImportFolders } from '@/lib/lineContract';

/** The routes the Import agent screen calls (a slice of the shared LINE_API mirror); approvals go to the plan. */
export type ImportAgentApi = Pick<LineHttp,
  'importFolders' | 'getImportAgent' | 'startImportAgent' | 'resumeImportAgent' | 'pauseImportAgent' | 'editImportStep' | 'answerImportAgent' | 'approvePlanStep'>;

/** The screen's state. `error` is one plain-English sentence from the last refused call. */
export type AgentState = {
  folders: ImportFolders | null;
  folder: string;
  view: ImportAgentView | null;
  busy: boolean;
  error: string | null;
  editing: string | null;
};

export type AgentEvent =
  | { type: 'FOLDERS'; folders: ImportFolders }
  | { type: 'SET_FOLDER'; folder: string }
  | { type: 'CALL' }
  | { type: 'VIEW'; view: ImportAgentView }
  | { type: 'REFUSED'; sentence: string }
  | { type: 'EDIT'; stepId: string | null };

/** The one main action the screen offers now (domain/AgentRules.ts mainAction). */
export type MainAction = { id: 'start' | 'approve-all' | 'approve-run' | 'resume'; label: string } | null;

/** One plan step as the screen shows it, with the actions it allows now. */
export type StepRowModel = {
  id: string;
  n: number;
  sentence: string;
  review: string;
  run: string;
  reviewLabel: string;
  runLabel: string;
  outcome: string | null;
  canApprove: boolean;
  canEdit: boolean;
  skipLabel: string | null;
  up: number | null;
  down: number | null;
  editing: boolean;
  fields: { key: string; label: string; value: string }[];
  details: string[];
};

export type QuestionModel = { id: string; sentence: string; options: { id: string; sentence: string; recommended: boolean }[] };
export type CheckModel = { id: string; state: string; label: string; sentence: string; details: string[] };

/** Everything the screen shows (domain/AgentScreen.ts agentScreen). */
export type AgentScreen = {
  started: boolean;
  stages: { id: string; label: string; status: string }[];
  sentence: string | null;
  message: string | null;
  question: QuestionModel | null;
  main: MainAction;
  canPause: boolean;
  rows: StepRowModel[];
  checks: CheckModel[];
  decider: string | null;
  decisions: string[];
  changes: string[];
};

/** What the screen's controls do (by step id). */
export type AgentActions = {
  setFolder: (folder: string) => void;
  start: () => void;
  runMain: () => void;
  pause: () => void;
  answer: (questionId: string, optionId: string) => void;
  approveStep: (stepId: string) => void;
  skip: (stepId: string) => void;
  move: (stepId: string, to: number) => void;
  openEdit: (stepId: string | null) => void;
  saveEdit: (stepId: string, values: Record<string, string>) => void;
};

export type AgentControls = { state: AgentState; screen: AgentScreen; actions: AgentActions };
