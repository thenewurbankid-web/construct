// The requirement chain (#642, part of epic #616): the shapes every layer shares. Server shapes are ui/server's
// requirementApi.mjs (POST /api/requirement/read), which returns what packages/core's parseRequirement, placeCard and
// planFromBlocks produce; the screen state is what RequirementMachine.ts reduces.
import type { PlanDoc } from '@/features/plan';

export type NounKind = 'entity' | 'state' | 'ui-part' | 'external';
export type VerbKind = 'read' | 'write' | 'interact' | 'navigate';
export type PlacementKind = 'client-leaf' | 'server-read' | 'mutation' | 'presentational';

export type CardNoun = { id: string; kind: NounKind; text: string; properties?: string[] };
export type CardVerb = { id: string; kind: VerbKind; text: string; on: string[] };
/** One named check, and `from`: the word of the sentence that caused it ("safely"). */
export type CardCheck = { id: string; name: string; from: string; why: string };
export type Card = { source: { text: string }; nouns: CardNoun[]; verbs: CardVerb[]; checks: CardCheck[]; open: { id: string; text: string }[] };

/** A closed question of 2-5 options. `source` says whether a word of the card or a placement is being asked about. */
export type QuestionOption = { id: string; label: string; enabled: boolean; why: string };
export type Question = { id: string; question: string; options: QuestionOption[]; chosen: string | null; source: 'card' | 'placement' };

export type PlacementLayer = { layer: string; name: string; why: string };
export type PlacementBlock = {
  id: string;
  label: string;
  placement: PlacementKind;
  answers: { browserApi: boolean; touchesSecretOrDb: boolean; changesBackend: boolean };
  layers: PlacementLayer[];
  checkNames: string[];
  why: string;
};
export type Placement = {
  ok: boolean;
  complete: boolean;
  framework: string;
  blocks: PlacementBlock[];
  notes: string[];
  errors: { code: string; path: string; message: string }[];
};

export type ReadResult = {
  card: Card;
  /** null while a word of the card is still open: nothing is placed until a person answers it. */
  placement: Placement | null;
  plan: PlanDoc | null;
  /** The files each block will create, by block id. */
  files: Record<string, string[]>;
  open: Question[];
  warnings: string[];
  summary: { readBack: string[]; blocks: string[] };
};

/** An answer to a closed question, sent back with the sentence: the server replays them in order. */
export type Answer = { id: string; option: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type ReadState = { status: 'idle' | 'loading' | 'ready' | 'failed'; result: ReadResult | null; error: string | null };
export type ApproveState = { status: 'idle' | 'running' | 'started' | 'failed'; processId: string | null; error: string | null };
export type NoteState = { status: 'idle' | 'saving' | 'saved' | 'failed'; error: string | null };

export type ScreenState = { text: string; answers: Answer[]; read: ReadState; approve: ApproveState; note: NoteState };

export type ScreenAction =
  | { type: 'TEXT'; text: string }
  | { type: 'ANSWERS'; answers: Answer[] }
  | { type: 'READ_LOADING' }
  | { type: 'READ_LOADED'; result: ReadResult }
  | { type: 'READ_FAILED'; error: string }
  | { type: 'APPROVE_RUNNING' }
  | { type: 'APPROVE_STARTED'; processId: string }
  | { type: 'APPROVE_FAILED'; error: string }
  | { type: 'NOTE_SAVING' }
  | { type: 'NOTE_SAVED' }
  | { type: 'NOTE_FAILED'; error: string };

export type TimelineKind = 'page-load' | 'server-read' | 'presentation' | 'interaction' | 'mutation' | 'redirect';

/** One step of the read-back, in the order the blocks run. */
export type TimelineStep = {
  order: number;
  kind: TimelineKind;
  /** "Page load", "Server read"... */
  title: string;
  /** The block that owns this step, or null for the page load itself. */
  blockId: string | null;
  /** The layers of that block ("service SubscriptionPlan"), so the step shows which units run. */
  owner: string[];
  /** The named checks that guard this step. */
  checks: string[];
  /** One plain-English line. */
  line: string;
};
