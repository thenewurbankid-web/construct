'use client';

import { useCallback, useState } from 'react';
import { ask } from '../services/LineTrainApi';
import { draftFor, previewEdit } from '../workflows/TeachActions';
import { setSlot } from '../workflows/DraftSlots';
import type { DraftEdit, TrainDraft, TrainHttp } from '../types';

/** A typed request and the drafter's routes for it, as a draft the person corrects: the intent (closed picker), each
 * slot (closed choice or typed value), and "Did you mean ...?" for a word the project does not know. */
export function useDraft(api: TrainHttp, world: string, onError: (s: string | null) => void) {
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<DraftEdit | null>(null);
  const [meta, setMeta] = useState<TrainDraft | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const submit = useCallback(async (t?: string) => {
    const a = await draftFor(api, (t ?? text).trim(), world);
    if (!a.ok) { onError(a.sentence); return; }
    onError(a.value.draft.sentence ?? null);
    setEdit(a.value.edit); setMeta(a.value.draft); setValues(a.value.values);
  }, [api, text, world, onError]);
  const refill = useCallback(async (next: DraftEdit) => {
    setEdit(next);
    const a = await previewEdit(api, next);
    if (!a.ok) { onError(a.sentence); return; }
    onError(null);
    setEdit(a.value.edit); setValues(a.value.values);
  }, [api, onError]);
  const meant = useCallback(async (word: string, ref: string) => {
    const a = await ask(() => api.synonym(world, word, ref));
    if (!a.ok) { onError(a.sentence); return; }
    await submit();
  }, [api, world, onError, submit]);
  return {
    text, setText, edit, setEdit, meta, values, submit, refill, meant,
    setIntent: (id: string) => setEdit((e) => (e ? { ...e, intent: id } : e)),
    setSlot: (name: string, value: string, kind: 'pick' | 'text' | 'number') => { if (edit) void refill(setSlot(edit, name, value, kind)); },
  };
}
