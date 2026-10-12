// im3 + j5: read the open project's memory and forget one step's, each answer as {sentence, view} for the panel.
import type { AiStepsApi, MemoryView } from '../types';

export type MemoryAnswer = { view: MemoryView | null; sentence: string; message: string | null };

const UNREADABLE = 'What Line remembers could not be read; Line ranks by its static order meanwhile.';

/** Reads the memory view; a refusal keeps its own sentence. */
export async function loadMemory(api: AiStepsApi): Promise<MemoryAnswer> {
  try {
    const r = await api.getMemory();
    if (r && r.ok === true) return { view: r, sentence: r.sentence, message: null };
    return { view: null, sentence: r && 'sentence' in r ? r.sentence : UNREADABLE, message: null };
  } catch {
    return { view: null, sentence: UNREADABLE, message: null };
  }
}

/** Forgets one step's memory (the server checks it is a person); the answer carries the new sizes and what was done. */
export async function forgetMemory(api: AiStepsApi, step: string, before: MemoryAnswer): Promise<MemoryAnswer> {
  try {
    const r = await api.forgetMemory(step);
    if (r && r.ok === true) return { view: r, sentence: r.sentence, message: r.message };
    return { ...before, message: r && 'sentence' in r ? r.sentence : 'Line could not forget that; nothing was changed.' };
  } catch {
    return { ...before, message: 'Line could not forget that; nothing was changed.' };
  }
}
