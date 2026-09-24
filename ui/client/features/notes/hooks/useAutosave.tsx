'use client';

import { useEffect } from 'react';
import { AUTOSAVE_MS, isDirty, isReadOnly } from '../domain/NoteDraft';
import type { ScreenState } from '../domain/NoteTypes';

/**
 * Autosave: 800 ms after the last keystroke. The text is never blocked; a failed save or a stale write waits for
 * a person (Retry, Keep mine, Load theirs) rather than retrying in a loop. Also warns before the tab closes while
 * anything is unsaved, since that text lives only in the page.
 */
export function useAutosave(state: ScreenState, save: () => Promise<boolean>): void {
  const { note, draft } = state;
  const status = state.save.status;
  const dirty = isDirty(note, draft);
  useEffect(() => {
    if (!dirty || isReadOnly(note) || (status !== 'idle' && status !== 'saved')) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, note, draft, status, save]);
  useEffect(() => {
    if (!dirty || isReadOnly(note)) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, note]);
}
