// Durable Notes (#596): the view models the controller hands to the presentation-only components
// (COMPONENT-003: a component gets props, never application logic). Server shapes and the screen state are
// domain/NoteTypes.ts.
import type { CompareLine } from './domain/NoteTypes';

export type IndicatorView = { tone: 'idle' | 'busy' | 'ok' | 'warn' | 'bad'; text: string; icon: string };

export type TagView = { label: string; tone: 'draft' | 'ready' | 'stale' | 'run' };

export type ConflictView = {
  /** True while the Compare panel is open. */
  comparing: boolean;
  lines: CompareLine[];
  titleChanged: { mine: string; theirs: string } | null;
};

export type EditorView = {
  title: string;
  body: string;
  readOnly: boolean;
  indicator: IndicatorView;
  /** Shown under the indicator after a failed save ("Your text stays in the page..."). */
  failureHint: string | null;
  tag: TagView;
  /** "Process p-1" for a note that ran. */
  ranNote: string | null;
  confirmingDelete: boolean;
  conflict: ConflictView | null;
  failed: boolean;
};

export type EditorHandlers = {
  onTitle: (title: string) => void;
  onBody: (body: string) => void;
  /** Blur flushes: the text is saved now instead of after the pause. */
  onBlur: () => void;
  onRetry: () => void;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
  onToggleCompare: () => void;
  onDuplicate: () => void;
  onConfirmDelete: (on: boolean) => void;
  onDelete: () => void;
};

export type NoteEditorProps = { view: EditorView } & EditorHandlers;

export type RowView = { id: string; title: string; preview: string; tag: TagView; active: boolean; when: string };

export type NotesBrowserProps = {
  rows: RowView[];
  status: 'idle' | 'loading' | 'ready' | 'failed';
  error: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
};
