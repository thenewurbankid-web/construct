import { itemGroups, specView } from '../domain/ItemGroups';
import type { DetailState, LineFeaturesApi } from '../types';

const UNREADABLE = 'This feature could not be read, so try again.';

/** Reads one feature through the API and turns it into what the screen shows; a refusal keeps its own sentence. */
export async function loadFeature(api: LineFeaturesApi, name: string): Promise<DetailState> {
  try {
    const r = await api.getFeature(name);
    if (r && 'items' in r && 'summary' in r) return { phase: 'ready', detail: r, groups: itemGroups(r), spec: specView(r) };
    if (r && 'sentence' in r && typeof r.sentence === 'string') return { phase: 'error', sentence: r.sentence };
    return { phase: 'error', sentence: UNREADABLE };
  } catch {
    return { phase: 'error', sentence: UNREADABLE };
  }
}
