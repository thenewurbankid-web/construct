// Blocks (#407): the view models the controller hands to the presentation-only components (COMPONENT-003: a component
// gets props, never application logic). Server shapes and the screen state are domain/BlockTypes.ts.
import type { Engine } from './domain/BlockTypes';

export type ArgView = { name: string; label: string; kind: string; description: string | null };

export type BlockCardView = {
  id: string;
  purpose: string;
  enabled: boolean;
  /** Why the card is turned off or not offered, in a sentence; null when it is plain and on. */
  offNote: string | null;
  kind: { label: string; tone: 'read' | 'write' };
  model: { label: string; tone: 'none' | 'optional' };
  reads: string;
  writes: string;
  runs: string;
  args: ArgView[];
  example: { title: string; command: string | null } | null;
  /** Only on a block with a model path: the default engine and model. */
  engine: { value: Engine; model: string; provider: string } | null;
  /** Null when Run is available; else the plain reason it is not. */
  runBlocked: string | null;
  /** The server's plain refusal of the last change to this card, or null. */
  refusal: string | null;
  saving: boolean;
  /** True when the toggle cannot be used (never offered in the Cockpit). */
  locked: boolean;
};

export type BlocksView = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  error: string | null;
  /** The settings file could not be read: the server refuses every plan until it is reset. */
  unreadable: string | null;
  summary: string;
  filter: string;
  cards: BlockCardView[];
  /** A refusal that is about no single card (for example a stale save). */
  notice: string | null;
  empty: string | null;
};

export type BlocksBrowserProps = {
  view: BlocksView;
  onFilter: (text: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onEngine: (id: string, engine: Engine) => void;
  onModel: (id: string, model: string) => void;
  /** Absent when the tab has no plan to add a step to: the cards then have no Run button. */
  onRun?: (id: string) => void;
  onRetry: () => void;
  onReset: () => void;
};
