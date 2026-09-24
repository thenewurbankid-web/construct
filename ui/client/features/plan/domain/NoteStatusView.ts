// Pure (DOMAIN-001): the one line the ticket pane shows about the durable note (#609).
import type { NoteStatusView } from '../types.ts';
import type { ScreenState } from './PlanTypes.ts';

export const buildNoteStatus = (s: ScreenState): NoteStatusView => {
  const save = s.noteSave;
  const planStale = s.note?.planStale === true && s.note.status !== 'ran' && s.steps.length > 0;
  const base = { planStale, canRetry: false, canResolve: false };
  if (save.status === 'conflict') return { ...base, kind: 'conflict', label: 'This note changed in another tab or window. Keep yours, or load theirs.', canResolve: true };
  if (save.status === 'failed') return { ...base, kind: 'failed', label: `Not saved: ${save.message} Your text is still here.`, canRetry: true };
  if (save.status === 'saving') return { ...base, kind: 'saving', label: 'Saving...' };
  if (s.note?.status === 'ran') return { ...base, kind: 'ran', label: 'This note ran, so it is kept as history. Changing it starts a copy.' };
  if (s.note !== null) return { ...base, kind: 'saved', label: 'Saved on this machine' };
  return { ...base, kind: 'none', label: 'Saved on this machine as you type.' };
};
