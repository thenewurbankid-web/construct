'use client';

import { useCallback, type MutableRefObject } from 'react';
import { rowOf } from '../domain/NoteDraft';
import type { Draft, ScreenAction, ScreenState } from '../domain/NoteTypes';
import { createNote, duplicateNote, fetchNote, removeNote } from '../services/NotesApi';

/** Everything a person does on the Notes screen apart from typing: switch, create, duplicate, delete, and the way out of a stale write. */
export function useNoteActions(stateRef: MutableRefObject<ScreenState>, send: (a: ScreenAction) => void, save: () => Promise<boolean>) {
  const open = useCallback(
    async (id: string) => {
      if (stateRef.current.note?.id === id) return;
      // #836 -- lock the editor before the round trip starts: the note on screen is about to be replaced, and
      // without this a keystroke typed in that window lands on it and is then silently dropped when OPENED
      // below resets `draft` for the note that lands.
      send({ type: 'OPEN_STARTED' });
      // Never leave a note with text the server does not have: save first, and stay put if that fails.
      if (!(await save())) {
        send({ type: 'SWITCH_ABORTED' });
        return;
      }
      const r = await fetchNote(id);
      send(r.ok ? { type: 'OPENED', note: r.data } : { type: 'OPEN_FAILED', error: r.error });
    },
    [stateRef, send, save],
  );

  const add = useCallback(
    async (make: () => ReturnType<typeof createNote>) => {
      // #836 -- same lock as `open`: New note / Duplicate also replace what is on screen asynchronously.
      send({ type: 'OPEN_STARTED' });
      if (!(await save())) {
        send({ type: 'SWITCH_ABORTED' });
        return;
      }
      const r = await make();
      if (!r.ok) return send({ type: 'OPEN_FAILED', error: r.error });
      send({ type: 'LIST_UPSERT', row: rowOf(r.data) });
      return send({ type: 'OPENED', note: r.data });
    },
    [send, save],
  );

  const create = useCallback(() => add(() => createNote()), [add]);

  const duplicate = useCallback(() => {
    const id = stateRef.current.note?.id;
    return id ? add(() => duplicateNote(id)) : Promise.resolve();
  }, [stateRef, add]);

  const remove = useCallback(async () => {
    const { note, list } = stateRef.current;
    if (!note) return;
    // #836 -- same lock: the note on screen is about to be removed (and possibly replaced by the next one).
    send({ type: 'OPEN_STARTED' });
    const r = await removeNote(note.id);
    if (!r.ok) return send({ type: 'OPEN_FAILED', error: r.error });
    send({ type: 'LIST_REMOVE', id: note.id });
    const next = list.rows.find((row) => row.id !== note.id);
    if (!next) return send({ type: 'CLOSED' });
    const one = await fetchNote(next.id);
    return send(one.ok ? { type: 'OPENED', note: one.data } : { type: 'CLOSED' });
  }, [stateRef, send]);

  const edit = useCallback((e: Partial<Draft>) => send({ type: 'EDIT', edit: e }), [send]);
  const keepMine = useCallback(() => send({ type: 'KEEP_MINE' }), [send]);
  const loadTheirs = useCallback(() => send({ type: 'LOAD_THEIRS' }), [send]);
  const toggleCompare = useCallback(() => send({ type: 'TOGGLE_COMPARE' }), [send]);
  const confirmDelete = useCallback((on: boolean) => send({ type: 'CONFIRM_DELETE', on }), [send]);

  return { open, create, duplicate, remove, edit, keepMine, loadTheirs, toggleCompare, confirmDelete, retry: save, flush: save };
}
