import type { ImportPlanRequest, LineHttp, LineRefusal } from '@/lib/lineContract';

export type {
  ImportApplyResult, ImportFolders, ImportFound, ImportPlan, ImportQuestion, ImportScan, ImportStep, LineRefusal,
} from '@/lib/lineContract';
import type { ImportApplyResult, ImportFolders, ImportFound, ImportPlan, ImportScan, ImportStep } from '@/lib/lineContract';

/** A refused Apply after some steps landed: the plan step that needs the person, the import steps not run yet, and how
 * many landed. The person picks Undo (line.import.undo puts the folder back) or Leave (carry on with the rest). */
export type ImportPending = { planStepId: string; rest: ImportStep[]; landed: number };
/** What Apply, Undo or Leave answers: the result, `pending` while the person must choose, `undone` once undone. */
export type ImportApplyOutcome = ImportApplyResult & { pending?: ImportPending; undone?: boolean };

/** The routes the Import screen calls (a slice of the shared LINE_API mirror), and Apply: the plan's steps added to the
 * project's plan, approved by the click and run (services/ImportApi.ts), or the mock's apply in Line mock mode. Undo and
 * Leave answer a refused Apply's `pending`, each as plan steps the click approves. */
export type ImportApi = Pick<LineHttp, 'importFolders' | 'importScan' | 'importPlan'> & {
  importApply: (req: ImportPlanRequest, plan: ImportPlan | null) => Promise<ImportApplyOutcome | LineRefusal>;
  importUndo: (folder: string, before: ImportApplyOutcome) => Promise<ImportApplyOutcome | LineRefusal>;
  importLeave: (folder: string, before: ImportApplyOutcome, plan: ImportPlan | null) => Promise<ImportApplyOutcome | LineRefusal>;
};

/** A question's id -> the option id picked (missing: the recommended one). */
export type ImportAnswers = Record<string, string>;

/** The Import flow, one phase at a time. `error` is one plain-English sentence from the last refused call. */
export type ImportState = {
  phase: 'pick' | 'scanning' | 'scanned' | 'planning' | 'planned' | 'applying' | 'applied';
  folders: ImportFolders | null;
  folder: string;
  scan: ImportScan | null;
  answers: ImportAnswers;
  plan: ImportPlan | null;
  result: ImportApplyOutcome | null;
  error: string | null;
};

export type ImportEvent =
  | { type: 'FOLDERS'; folders: ImportFolders }
  | { type: 'SET_FOLDER'; folder: string }
  | { type: 'SCAN' }
  | { type: 'SCANNED'; scan: ImportScan }
  | { type: 'ANSWER'; questionId: string; optionId: string }
  | { type: 'PLAN' }
  | { type: 'PLANNED'; plan: ImportPlan }
  | { type: 'APPLY' }
  | { type: 'APPLIED'; result: ImportApplyOutcome }
  | { type: 'UNDO' }
  | { type: 'LEAVE' }
  | { type: 'REFUSED'; sentence: string };

/** One group of the scan table: the library, or one feature. */
export type FoundGroup = { key: string; title: string; items: ImportFound[] };

/** One found item as the scan table shows it. */
export type FoundRow = { file: string; name: string; kindLabel: string; sentence: string; asks: boolean; details: string[] };
/** One question as shown: options in order (recommended first), each marked when picked. */
export type QuestionView = { id: string; sentence: string; options: { id: string; sentence: string; recommended: boolean; picked: boolean }[] };
/** Everything the screen shows, computed from the state (domain/ImportView.ts importView). */
export type ImportViewModel = {
  busy: boolean;
  summary: string | null;
  groups: { key: string; title: string; rows: FoundRow[] }[];
  unchanged: string[];
  routes: string[];
  questions: QuestionView[];
  canPlan: boolean;
};

/** What the screen's controls do. */
export type ImportControls = {
  state: ImportState;
  view: ImportViewModel;
  setFolder: (folder: string) => void;
  scan: () => void;
  answer: (questionId: string, optionId: string) => void;
  plan: () => void;
  apply: () => void;
  undo: () => void;
  leave: () => void;
};
