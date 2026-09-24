'use client';

import { useEffect } from 'react';
import { pickInitial } from '../domain/NoteDraft';
import type { ScreenAction } from '../domain/NoteTypes';
import { fetchNote, listNotes } from '../services/NotesApi';

/** The address names the open note (`/notes?note=<id>`), so a reload lands on the same one. */
export const noteFromAddress = (): string | null => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('note'));

/** Reads the list once when the screen opens, then opens the note named in the address, else the most recent. */
export function useNotesLoad(send: (a: ScreenAction) => void): void {
  useEffect(() => {
    let cancelled = false;
    send({ type: 'LIST_LOADING' });
    (async () => {
      const r = await listNotes();
      if (cancelled) return;
      if (!r.ok) return send({ type: 'LIST_FAILED', error: r.error });
      send({ type: 'LIST_LOADED', rows: r.data });
      const id = pickInitial(r.data, noteFromAddress());
      if (id === null) return send({ type: 'CLOSED' });
      const one = await fetchNote(id);
      if (cancelled) return;
      return send(one.ok ? { type: 'OPENED', note: one.data } : { type: 'OPEN_FAILED', error: one.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [send]);
}
