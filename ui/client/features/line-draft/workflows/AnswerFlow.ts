// The person's answer to "Did you mean ...?": store it in the project's domain map, then draft the same request again
// (one click: the answer and the new draft come back together).
import type { DraftAnswer, DraftView, LineDraftApi } from '../types.ts';

/** Answer one question and re-draft the request. */
export async function answerAndRedraft(api: LineDraftApi, request: string, word: string, key: string): Promise<DraftAnswer<DraftView>> {
  const a = await api.answer(word, key);
  if (!a.ok) return a;
  return api.draft(request);
}
