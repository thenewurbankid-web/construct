import { ask } from '../services/LineTrainApi';
import type { Answer, DraftEdit, TrainHttp, TrainTry } from '../types';
import { saveRequest } from './SaveCase.ts';

/** "Try it": one route in a scratch copy of the world (never the open project). */
export async function tryOne(api: TrainHttp, edit: DraftEdit, id: string): Promise<Answer<TrainTry>> {
  const route = edit.routes.find((r) => r.id === id);
  if (!route) return { ok: false, sentence: 'That route is no longer in the draft.' };
  return ask(() => api.tryRoute({ world: edit.world, slots: edit.slots, route }));
}

/** Save the corrected draft as an agreed training case; the answer is one sentence either way. */
export async function saveEdit(api: TrainHttp, edit: DraftEdit): Promise<Answer<string>> {
  const r = saveRequest(edit);
  if (!r.ok) return r;
  const a = await ask(() => api.save(r.req));
  if (!a.ok) return a;
  const n = r.req.routes.length;
  return { ok: true, value: `Saved as a training case with ${n} valid route${n === 1 ? '' : 's'}; Construct checked every one in a scratch copy.` };
}
