'use client';

import { useCallback, useRef, type MutableRefObject } from 'react';
import { isDirty, isReadOnly, rowOf } from '../domain/NoteDraft';
import type { ScreenAction, ScreenState } from '../domain/NoteTypes';
import { saveNote } from '../services/NotesApi';

/**
 * Save the open note against the rev the server last confirmed. Saves run one at a time, in order, and each one
 * reads the latest state when it starts, so a save queued behind another never goes out with a rev the first
 * one already moved on. Resolves true when nothing is left unsaved. A failure or a stale write resolves false and
 * leaves the typed text in the page.
 */
export function useNoteSave(stateRef: MutableRefObject<ScreenState>, send: (a: ScreenAction) => void): () => Promise<boolean> {
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const saveNow = useCallback(async (): Promise<boolean> => {
    const { note, draft, save } = stateRef.current;
    if (note === null || isReadOnly(note)) return true;
    if (!isDirty(note, draft)) return true;
    if (save.status === 'conflict') return false;
    send({ type: 'SAVE_STARTED' });
    const r = await saveNote(note.id, note.rev, draft);
    if (r.kind === 'ok') {
      send({ type: 'SAVE_OK', note: r.note, sent: draft });
      send({ type: 'LIST_UPSERT', row: rowOf(r.note) });
      return true;
    }
    if (r.kind === 'conflict') send({ type: 'SAVE_CONFLICT', theirs: r.current });
    else send({ type: 'SAVE_FAILED', message: r.message, code: r.code });
    return false;
  }, [stateRef, send]);
  return useCallback(() => {
    const p = chain.current.then(saveNow);
    chain.current = p.catch(() => undefined);
    return p;
  }, [saveNow]);
}
