import { trainHttp } from '@/lib/trainHttp';
import type { LineRefusal } from '@/lib/lineContract';
import type { Answer, TrainHttp } from '../types';

// Train Line's use of the shared TRAIN_API mirror (lib/trainHttp.ts). Every answer is the body or one sentence: a
// refusal ({ok: false, sentence}) keeps its sentence, a silent server becomes one.
const SILENT = 'The Cockpit server did not answer; nothing was changed.';

/** Call the server and turn its answer into the body or one sentence. */
export async function ask<T>(call: () => Promise<T>): Promise<Answer<Exclude<T, LineRefusal>>> {
  try {
    const body = (await call()) as unknown as { ok?: boolean; sentence?: string };
    if (body && body.ok === false) return { ok: false, sentence: String(body.sentence ?? SILENT) };
    return { ok: true, value: body as unknown as Exclude<T, LineRefusal> };
  } catch {
    return { ok: false, sentence: SILENT };
  }
}

/** The Train Line server routes (tests pass their own). */
export const lineTrainApi: TrainHttp = trainHttp;
