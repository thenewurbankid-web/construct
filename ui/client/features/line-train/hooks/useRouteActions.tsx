'use client';

import { useCallback, useState } from 'react';
import { addRouteTo } from '../workflows/TeachActions';
import { saveEdit, tryOne } from '../workflows/TeachRun';
import { starRoute, toggleValid } from '../workflows/CorrectDraft';
import type { DraftEdit, TrainHttp, TrainTry } from '../types';

type Draft = { edit: DraftEdit | null; setEdit: (e: DraftEdit) => void; refill: (e: DraftEdit) => Promise<void> };

/** What the person does with the route cards: mark valid, star the preferred one, Try it in a scratch copy, add a
 * route with closed choices, and save the case. */
export function useRouteActions(api: TrainHttp, d: Draft, onSaved: () => void, onError: (s: string | null) => void) {
  const [tries, setTries] = useState<Record<string, TrainTry>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const { edit, setEdit, refill } = d;
  const tryRoute = useCallback(async (id: string) => {
    if (!edit) return;
    const a = await tryOne(api, edit, id);
    if (a.ok) setTries((t) => ({ ...t, [id]: a.value }));
    else onError(a.sentence);
  }, [api, edit, onError]);
  const addRoute = useCallback(async (tool: string, args: Record<string, unknown>) => {
    if (!edit) return;
    const a = await addRouteTo(api, edit, tool, args);
    if (a.ok) { onError(null); setEdit(a.value.edit); } else onError(a.sentence);
  }, [api, edit, onError, setEdit]);
  const save = useCallback(async () => {
    if (!edit) return;
    const a = await saveEdit(api, edit);
    setSaved(a.ok ? a.value : null);
    onError(a.ok ? null : a.sentence);
    if (a.ok) onSaved();
  }, [api, edit, onError, onSaved]);
  return {
    tries, saved, tryRoute, addRoute, save,
    reset: () => { setTries({}); setSaved(null); },
    toggleValid: (id: string) => { if (edit) void refill(toggleValid(edit, id)); },
    star: (id: string) => { if (edit) void refill(starRoute(edit, id)); },
  };
}
