import { aiStepRows } from '../domain/AiStepRows';
import type { AiStepsApi, AiStepsState } from '../types';

const UNREADABLE = 'The AI step settings could not be read, so try again.';

/** Reads the profiles and turns them into what the panel shows; a refusal keeps its own sentence. */
export async function loadAiSteps(api: AiStepsApi): Promise<AiStepsState> {
  try {
    const r = await api.getAiProfiles();
    if (r && 'profiles' in r && Array.isArray(r.profiles)) return { phase: 'ready', profiles: r, rows: aiStepRows(r) };
    if (r && 'sentence' in r && typeof r.sentence === 'string') return { phase: 'error', sentence: r.sentence };
    return { phase: 'error', sentence: UNREADABLE };
  } catch {
    return { phase: 'error', sentence: UNREADABLE };
  }
}
