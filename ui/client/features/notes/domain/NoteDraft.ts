// Pure (DOMAIN-001): what "unsaved" means, what a list row looks like for a note, and which notes are read-only.
import type { Draft, Note, NoteRow } from './NoteTypes.ts';

/** Autosave fires this long after the last keystroke (design: docs/design/ia-five-screens.md section 5). */
export const AUTOSAVE_MS = 800;

const PREVIEW_CHARS = 140;

export const draftOf = (note: Note): Draft => ({ title: note.title, body: note.body });

export const sameDraft = (a: Draft, b: Draft): boolean => a.title === b.title && a.body === b.body;

/** Unsaved: the page holds text the server copy does not. */
export const isDirty = (note: Note | null, draft: Draft): boolean => note !== null && !sameDraft(draftOf(note), draft);

/** A note that already ran is history: it is read, duplicated, deleted, never edited. */
export const isReadOnly = (note: Note | null): boolean => note?.status === 'ran';

/** The list row for a note, built the way the server builds it, so the list can follow a save without a refetch. */
export function rowOf(note: Note): NoteRow {
  const flat = note.body.replace(/\s+/g, ' ').trim();
  return {
    id: note.id,
    title: note.title,
    preview: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}...` : flat,
    status: note.status,
    rev: note.rev,
    hasPlan: note.plan != null,
    planStale: note.planStale === true,
    processId: note.processId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** Newest-updated first, the order the server lists them in. */
export const byRecent = (rows: NoteRow[]): NoteRow[] => [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** The note to open when the screen loads: the one named in the address if it exists, else the most recent. */
export function pickInitial(rows: NoteRow[], wanted: string | null): string | null {
  if (wanted && rows.some((r) => r.id === wanted)) return wanted;
  return rows[0]?.id ?? null;
}
