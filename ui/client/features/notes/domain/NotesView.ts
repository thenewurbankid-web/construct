// Pure (DOMAIN-001): the screen state as the words and flags the components draw.
import type { ConflictView, EditorView, RowView } from '../types.ts';
import { compareLines } from './NoteCompare.ts';
import { isDirty, isReadOnly } from './NoteDraft.ts';
import { clock, failureHint, indicatorOf, rowTitle, statusTag } from './NoteText.ts';
import type { ScreenState } from './NoteTypes.ts';

function conflictView(state: ScreenState): ConflictView | null {
  if (state.save.status !== 'conflict') return null;
  const theirs = state.save.theirs;
  const mine = state.draft;
  return {
    comparing: state.comparing,
    lines: state.comparing ? compareLines(mine.body, theirs.body) : [],
    titleChanged: mine.title !== theirs.title ? { mine: mine.title, theirs: theirs.title } : null,
  };
}

export function buildEditorView(state: ScreenState): EditorView | null {
  const { note, draft, save } = state;
  if (note === null) return null;
  const readOnly = isReadOnly(note);
  const conflict = conflictView(state);
  return {
    title: draft.title,
    body: draft.body,
    readOnly,
    indicator: indicatorOf(save, isDirty(note, draft), readOnly),
    failureHint: save.status === 'failed' ? failureHint(save.code) : null,
    tag: statusTag(note.status, note.planStale === true),
    ranNote: readOnly ? (note.processId ? `Process ${note.processId}` : 'Ran') : null,
    confirmingDelete: state.confirmingDelete,
    conflict,
    failed: save.status === 'failed',
  };
}

/** Rows for the Browser list; the open note's row follows what is typed. */
export function buildRows(state: ScreenState): RowView[] {
  return state.list.rows.map((row) => {
    const open = state.note?.id === row.id;
    const title = open ? state.draft.title : row.title;
    const flat = open ? state.draft.body.replace(/\s+/g, ' ').trim() : row.preview;
    return {
      id: row.id,
      title: rowTitle({ ...row, title }),
      preview: flat.length > 140 ? `${flat.slice(0, 140)}...` : flat,
      tag: statusTag(row.status, row.planStale),
      active: open,
      when: clock(row.updatedAt),
    };
  });
}
