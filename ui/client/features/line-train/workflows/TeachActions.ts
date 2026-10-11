import { ask } from '../services/LineTrainApi';
import type { Answer, DraftEdit, Drafted, TrainHttp } from '../types';
import { startEdit } from './CorrectDraft.ts';
import { withPreview, withRoute } from './DraftSlots.ts';

/** Ask the drafter for a typed request: its routes become an editable draft. */
export async function draftFor(api: TrainHttp, text: string, world: string): Promise<Answer<Drafted>> {
  const a = await ask(() => api.draft(text, world));
  if (!a.ok) return a;
  return { ok: true, value: { edit: startEdit(a.value), draft: a.value, values: a.value.values ?? {} } };
}

/** After a correction: the server fills the names back into the request and the route cards. */
export async function previewEdit(api: TrainHttp, edit: DraftEdit): Promise<Answer<{ edit: DraftEdit; values: Record<string, string> }>> {
  const a = await ask(() => api.preview({ world: edit.world, request: edit.request, slots: edit.slots, routes: edit.routes, preferred: String(edit.preferred ?? '') }));
  if (!a.ok) return a;
  if (!a.value.ok) return { ok: false, sentence: String(a.value.sentence ?? 'This does not fit the project yet.') };
  return { ok: true, value: { edit: withPreview(edit, a.value.request, a.value.routes), values: a.value.values ?? {} } };
}

/** A route added with closed choices joins the draft; the cards are filled again. */
export async function addRouteTo(api: TrainHttp, edit: DraftEdit, tool: string, args: Record<string, unknown>): Promise<Answer<{ edit: DraftEdit; values: Record<string, string> }>> {
  const a = await ask(() => api.addRoute({ world: edit.world, slots: edit.slots, tool, args }));
  if (!a.ok) return a;
  return previewEdit(api, withRoute(edit, a.value.slots, a.value.route));
}
