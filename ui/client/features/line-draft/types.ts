// The drafter box's view models. The shapes come from the one shared mirror (lib/lineContract.ts), which follows
// packages/engine/line/contract.mjs (DraftView).
import type { DraftAdded, DraftQuestion, DraftRouteView, DraftView } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** A drafter call's answer on the screen: the value, or one sentence saying why not. */
export type DraftAnswer<T> = { ok: true; value: T } | { ok: false; sentence: string; code?: string };

/** The service's surface, so the real API and a test double are interchangeable. */
export type LineDraftApi = {
  status: () => Promise<DraftAnswer<{ on: boolean }>>;
  draft: (request: string) => Promise<DraftAnswer<DraftView>>;
  add: (request: string, routeId: string, from?: number) => Promise<DraftAnswer<DraftAdded>>;
  answer: (word: string, key: string) => Promise<DraftAnswer<{ sentence: string }>>;
};

/** One route card: the sentence first, what Construct found, and whether the person can add it. */
export type RouteCard = {
  id: string;
  label: string;
  risk: string;
  sentence: string;
  status: DraftRouteView['status'];
  statusLabel: string;
  recommended: boolean;
  canAdd: boolean;
  fix: string | null;
  /** Details: the steps as tool calls, how it was found, its cost. */
  calls: string[];
  how: string;
  /** im3 + j5: why memory recommends it ("Recalled from 3 past decisions: ..."), else null. */
  memory: string | null;
  /** im2: the repair's live line (one sentence per attempt) and every attempt for Details; null when none was tried. */
  repair: { sentence: string; progress: string[]; tries: string[] } | null;
};

/** Everything the drafter box needs. */
export type DraftControls = {
  on: boolean;
  busy: boolean;
  request: string;
  setRequest: (text: string) => void;
  submit: () => void;
  cards: RouteCard[];
  questions: DraftQuestion[];
  defer: string | null;
  dropped: string[];
  notice: string | null;
  error: string | null;
  /** The route whose remaining steps can be added once its first ones ran. */
  pending: { routeId: string; from: number } | null;
  add: (routeId: string) => void;
  addRest: () => void;
  answer: (word: string, key: string) => void;
};
