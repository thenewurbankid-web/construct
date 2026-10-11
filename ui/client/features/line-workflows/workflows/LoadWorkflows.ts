import type { LineWorkflowsApi, ListState } from '../types';

const UNREADABLE = "This feature's workflows could not be read, so try again.";

/** Reads one feature's workflows; a refusal keeps its own sentence, a silent server is one sentence. */
export async function loadWorkflows(api: LineWorkflowsApi, feature: string): Promise<ListState> {
  try {
    const r = await api.getWorkflows(feature);
    if (r && 'workflows' in r && Array.isArray(r.workflows)) return { phase: 'ready', list: r };
    if (r && 'sentence' in r && typeof r.sentence === 'string') return { phase: 'error', sentence: r.sentence };
    return { phase: 'error', sentence: UNREADABLE };
  } catch {
    return { phase: 'error', sentence: UNREADABLE };
  }
}
