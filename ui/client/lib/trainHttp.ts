import { getJson, postJson } from '@/lib/http';
import type { TrainHttp } from './lineContract';

// The client's mirror of TRAIN_API (packages/engine/line/train/contract.mjs), served by ui/server's lineTrainApi.mjs.
// Train Line never touches the open project: its worlds are imaginary or the Line sample, tried in scratch copies.
// A refusal arrives as 400 {ok: false, sentence, code} and reaches the screen as its sentence.
export const trainHttp: TrainHttp = {
  worlds: () => getJson('/api/line/train/worlds'),
  cases: (filter, limit, offset = 0) => getJson(`/api/line/train/cases?${new URLSearchParams({ filter, limit: String(limit), offset: String(offset) }).toString()}`),
  choices: (world) => getJson(`/api/line/train/facts?world=${encodeURIComponent(world)}`),
  draft: (request, world) => postJson('/api/line/train/draft', { request, world }),
  preview: (req) => postJson('/api/line/train/preview', req),
  addRoute: (req) => postJson('/api/line/train/route', req),
  tryRoute: (req) => postJson('/api/line/train/try', req),
  save: (req) => postJson('/api/line/train/cases', req),
  review: (id, verdict, note) => postJson('/api/line/train/review', { id, verdict, ...(note ? { note } : {}) }),
  synonym: (world, word, ref) => postJson('/api/line/train/synonym', { world, word, ref }),
  runEval: () => postJson('/api/line/train/eval', {}),
  scoreboard: () => getJson('/api/line/train/scoreboard'),
};
