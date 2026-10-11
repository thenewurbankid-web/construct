import { lineHttp } from '@/lib/lineHttp';
import { toDraftAnswer } from '../domain/RouteCards';
import type { DraftAdded, DraftAnswer, DraftView, LineDraftApi } from '../types';

// The drafter box's use of the shared LINE_API mirror (lib/lineHttp.ts): /api/line/plan/draft and its writes.
async function send<T>(call: () => Promise<unknown>): Promise<DraftAnswer<T>> {
  try {
    return toDraftAnswer<T>(await call());
  } catch {
    return { ok: false, sentence: 'The Cockpit server did not answer; nothing was changed.' };
  }
}

export const lineDraftApi: LineDraftApi = {
  status: () => send<{ on: boolean }>(() => lineHttp.getDraftStatus()),
  draft: (request) => send<DraftView>(() => lineHttp.draft(request)),
  add: (request, routeId, from) => send<DraftAdded>(() => lineHttp.addDraftRoute(request, routeId, from)),
  answer: (word, key) => send<{ sentence: string }>(() => lineHttp.answerDraft(word, key)),
};
