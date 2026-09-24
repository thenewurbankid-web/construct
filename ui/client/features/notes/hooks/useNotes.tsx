'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { initialScreen, screenReducer } from '../workflows/NotesMachine';
import type { ScreenAction } from '../domain/NoteTypes';
import { useAutosave } from './useAutosave';
import { useNoteActions } from './useNoteActions';
import { useNoteSave } from './useNoteSave';
import { useNotesLoad } from './useNotesLoad';

/**
 * The Notes screen, composed from small hooks. Notes are durable drafts on this machine: autosaved 800 ms after
 * the last keystroke, kept across reloads and server restarts, never sent anywhere and never read by a model.
 *
 * `stateRef` is the same state the reducer holds, advanced in the same order by `send`, so a save that starts
 * right after another one finishes reads the rev the server just confirmed, not the one from the last render.
 */
export function useNotes() {
  const [state, dispatch] = useReducer(screenReducer, initialScreen);
  const stateRef = useRef(state);
  const send = useCallback((a: ScreenAction) => {
    stateRef.current = screenReducer(stateRef.current, a);
    dispatch(a);
  }, []);
  useNotesLoad(send);
  const save = useNoteSave(stateRef, send);
  useAutosave(state, save);
  const actions = useNoteActions(stateRef, send, save);
  const openId = state.note?.id ?? null;
  // The address follows the open note, so a reload (or a shared link on this machine) lands on it.
  useEffect(() => {
    if (openId === null) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('note') === openId) return;
    url.searchParams.set('note', openId);
    window.history.replaceState(window.history.state, '', url);
  }, [openId]);
  return { state, ...actions };
}
