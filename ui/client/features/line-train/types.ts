// Train Line view types. The wire shapes are the client's mirror of TRAIN_API (lib/lineContract.ts).
import type {
  FilledRoute, Scoreboard, ScoreRow, TrainCaseList, TrainCaseView, TrainChoices, TrainDraft, TrainHttp, TrainRoute, TrainSlots, TrainTry, TrainWorld,
} from '@/lib/lineContract';

export type { FilledRoute, Scoreboard, ScoreRow, TrainCaseList, TrainCaseView, TrainChoices, TrainDraft, TrainHttp, TrainRoute, TrainSlots, TrainTry, TrainWorld };

/** A server answer as the screen takes it: the body, or one sentence. */
export type Answer<T> = { ok: true; value: T } | { ok: false; sentence: string };

/** The draft the person is correcting: the drafter's routes, which of them are valid, the starred one, the intent. */
export type DraftEdit = {
  world: string;
  request: string;
  slots: TrainSlots;
  routes: TrainRoute[];
  valid: Record<string, boolean>;
  preferred: string | null;
  intent: string;
  filled: FilledRoute[];
  filledRequest: string;
};

/** The drafter's answer turned into an editable draft, with each slot's current text. */
export type Drafted = { edit: DraftEdit; draft: TrainDraft; values: Record<string, string> };

/** One route card on the screen. */
export type RouteCardView = FilledRoute & { valid: boolean; starred: boolean; tried: TriedView | null; steps_n: string; stepLines: string[]; starLabel: string; chip: string };

/** A Try it run as shown: its sentence, then each check as "Passes: ..." or "Fails: ...". */
export type TriedView = { ok: boolean; sentence: string; checks: { text: string; ok: boolean }[] };

/** A closed choice for one slot of the request (feature, library item, item, problem), or a typed value. */
export type SlotChoice = { name: string; label: string; kind: 'pick' | 'text' | 'number'; current: string; options: { value: string; label: string }[] };

/** One field of the "Add a route" form. */
export type RouteField = { key: string; label: string; kind: 'pick' | 'text'; options: { value: string; label: string }[] };

/** One scoreboard row as shown: the numbers as percentages. */
export type ScoreLine = { key: string; label: string; cases: string; heldout: string; recall: string; precision: string; preferred: string; noRepair: string; agreement: string };

/** A stored case as its card shows it. */
export type CaseView = { id: string; by: string; request: string; intent: string; world: string; status: string; statusLine: string; canReview: boolean; cards: RouteCardView[]; slotted: string; intentId: string; split: string; problem: string };

/** What a case card's owner may do. */
export type ReviewControls = { busy: boolean; agree: (id: string) => void; disagree: (id: string, note: string) => void };

/** Everything the Train Line page shows and does. */
export type TrainScreen = {
  error: string | null;
  busy: boolean;
  queue: { cases: CaseView[]; total: number; open: number; more: () => void; review: ReviewControls };
  teach: TeachControls;
  score: { lines: ScoreLine[]; intents: ScoreLine[]; sentence: string; lastRun: string; run: () => void; running: boolean };
  map: { label: string; entries: { ref: string; type: string; name: string; words: string; synonyms: string }[] };
};

/** The "Teach a new request" panel. */
export type TeachControls = {
  worlds: TrainWorld[];
  world: string;
  chooseWorld: (key: string) => void;
  suggestions: string[];
  text: string;
  setText: (t: string) => void;
  submit: () => void;
  pick: (suggestion: string) => void;
  edit: DraftEdit | null;
  intentPhrase: string;
  intents: { id: string; phrase: string }[];
  setIntent: (id: string) => void;
  unknown: { word: string; choices: { ref: string; name: string }[] }[];
  meant: (word: string, ref: string) => void;
  slots: SlotChoice[];
  setSlot: (name: string, value: string) => void;
  cards: RouteCardView[];
  toggleValid: (id: string) => void;
  star: (id: string) => void;
  tryRoute: (id: string) => void;
  tools: { name: string; label: string }[];
  fieldsFor: (tool: string) => RouteField[];
  addRoute: (tool: string, values: Record<string, string>) => void;
  save: () => void;
  saved: string | null;
};
