'use client';

import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import { createNote, duplicateNote, fetchNote, saveNote, type Note } from '@/features/notes';
import { isUnsaved, keysOfNote, planPart, textKey, stepsKey, type SavedKeys } from '../domain/PlanNote';
import type { ScreenAction, ScreenState } from '../domain/PlanTypes';

/** Autosave fires this long after the last keystroke, same as the Notes screen. */
const AUTOSAVE_MS = 800;
const PARAM = 'note';

const noteInAddress = (): string | null => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(PARAM));

/** The address follows the note (`?note=<id>`), so a reload lands on the same note with its plan. */
function followInAddress(id: string | null): void {
  const url = new URL(window.location.href);
  if (id === null ? !url.searchParams.has(PARAM) : url.searchParams.get(PARAM) === id) return;
  if (id === null) url.searchParams.delete(PARAM);
  else url.searchParams.set(PARAM, id);
  window.history.replaceState(window.history.state, '', url);
}

/**
 * The Plan screen's durable note (#609). Text autosaves as it is typed; step edits save the plan with it, and the
 * server marks the plan "out of date" when the text changes after. Run reads the saved note (`flush`) and the server
 * marks it ran. A note that already ran is read-only history: editing it (or running it again) starts a copy.
 * A failed save or a stale write waits for a person (Retry, Keep mine, Load theirs); the text is never lost.
 *
 * Nothing here calls a model.
 */
export function usePlanNote(state: ScreenState, dispatch: Dispatch<ScreenAction>) {
  const latest = useRef(state);
  latest.current = state;
  const saved = useRef<SavedKeys | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const { ticket, steps, note, noteSave } = state;

  const adopt = useCallback((n: Note, sent?: { text: string; steps: string }) => {
    saved.current = sent ?? keysOfNote(n);
    dispatch({ type: 'NOTE_SYNCED', note: n });
    followInAddress(n.id);
  }, [dispatch]);

  /** Save what is on screen now. Resolves to the confirmed note, or null when it could not be saved. */
  const persistNow = useCallback(async (opts: { force?: boolean } = {}): Promise<Note | null> => {
    const s = latest.current;
    const sent = { text: textKey(s.ticket), steps: stepsKey(s.steps) };
    const wantsPlan = opts.force === true;
    dispatch({ type: 'NOTE_SAVING' });
    try {
      let target = s.note;
      // A note that ran is history: what you do next happens in a copy of it.
      if (target?.status === 'ran') {
        const dup = await duplicateNote(target.id);
        if (!dup.ok) {
          dispatch({ type: 'NOTE_SAVE_FAILED', message: dup.error });
          return null;
        }
        saved.current = keysOfNote(dup.data);
        target = { id: dup.data.id, rev: dup.data.rev, status: dup.data.status, planStale: false, processId: null };
      }
      if (target === null) {
        const made = await createNote({ title: s.ticket.title, body: s.ticket.body });
        if (!made.ok) {
          dispatch({ type: 'NOTE_SAVE_FAILED', message: made.error });
          return null;
        }
        saved.current = { text: sent.text, steps: '[]' };
        target = { id: made.data.id, rev: made.data.rev, status: made.data.status, planStale: false, processId: null };
      }
      const extra = planPart(s, saved.current, wantsPlan);
      const r = await saveNote(target.id, target.rev, { title: s.ticket.title, body: s.ticket.body }, extra);
      if (r.kind === 'ok') {
        adopt(r.note, sent);
        return r.note;
      }
      if (r.kind === 'conflict') dispatch({ type: 'NOTE_CONFLICT', theirs: r.current });
      else dispatch({ type: 'NOTE_SAVE_FAILED', message: r.message });
      return null;
    } catch {
      dispatch({ type: 'NOTE_SAVE_FAILED', message: 'The Cockpit server could not be reached.' });
      return null;
    }
  }, [adopt, dispatch]);

  /** Saves run one at a time, so a save queued behind another reads the rev the first one just confirmed. */
  const persist = useCallback((opts?: { force?: boolean }) => {
    const p = chain.current.then(() => persistNow(opts));
    chain.current = p.catch(() => undefined);
    return p;
  }, [persistNow]);

  // Open the note the address names, once.
  useEffect(() => {
    const id = noteInAddress();
    if (id === null) return;
    let cancelled = false;
    fetchNote(id).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        saved.current = keysOfNote(r.data);
        dispatch({ type: 'NOTE_OPENED', note: r.data });
      } else if (r.code === 'NOT_FOUND') followInAddress(null);
      else dispatch({ type: 'NOTE_SAVE_FAILED', message: `That note could not be opened: ${r.error}` });
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // Autosave: 800 ms after the last change. A failed save or a conflict waits for a person, never loops.
  useEffect(() => {
    if (noteSave.status === 'failed' || noteSave.status === 'conflict' || noteSave.status === 'saving') return;
    if (!isUnsaved({ ticket, steps }, note === null ? null : saved.current)) return;
    const timer = setTimeout(() => void persist(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [ticket, steps, note, noteSave.status, persist]);

  // Warn before the tab closes while anything is unsaved, since that text lives only in the page.
  const unsaved = isUnsaved({ ticket, steps }, note === null ? null : saved.current);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  /** Before Run: save now and hand back the id of the note to run from. A note that already ran is copied first. */
  const flush = useCallback(async (): Promise<string | null> => {
    const s = latest.current;
    const clean = s.note && s.note.status !== 'ran' && s.noteSave.status !== 'failed' && s.noteSave.status !== 'conflict' && !isUnsaved(s, saved.current);
    if (clean && s.note) return s.note.id;
    const n = await persist({ force: s.note?.status === 'ran' });
    return n ? n.id : null;
  }, [persist]);

  /** After Run: the server marked the note ran; take its copy so the screen shows it. */
  const resync = useCallback(async (id: string) => {
    const r = await fetchNote(id);
    if (!r.ok) return;
    saved.current = { text: textKey(latest.current.ticket), steps: stepsKey(latest.current.steps) };
    dispatch({ type: 'NOTE_SYNCED', note: r.data });
  }, [dispatch]);

  const retry = useCallback(() => dispatch({ type: 'NOTE_RETRY' }), [dispatch]);
  const loadTheirs = useCallback(() => {
    const s = latest.current.noteSave;
    if (s.status !== 'conflict') return;
    saved.current = keysOfNote(s.theirs);
    dispatch({ type: 'NOTE_OPENED', note: s.theirs });
  }, [dispatch]);
  const keepMine = useCallback(() => {
    const s = latest.current.noteSave;
    if (s.status !== 'conflict') return;
    // Their rev, my text and plan: the next save goes out against the copy that won, so nothing is silently lost.
    saved.current = { text: '', steps: '' };
    dispatch({ type: 'NOTE_SYNCED', note: s.theirs });
    dispatch({ type: 'NOTE_RETRY' });
  }, [dispatch]);
  /** "Keep this plan": save the plan on screen against the newer text, which clears "Plan out of date". */
  const keepPlan = useCallback(() => {
    void persist({ force: true });
  }, [persist]);

  return { flush, resync, retry, loadTheirs, keepMine, keepPlan };
}
