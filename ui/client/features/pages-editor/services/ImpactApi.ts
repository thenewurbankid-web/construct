import { getJson } from '@/lib/http';

export type PageImpact = { ok: boolean; path: string; features: string[] };

/** GET /api/pages/impact (#379): the Inspector "Impact" section's blast radius for the open page file. */
export const getPageImpact = (feature: string, file: string) =>
  getJson<PageImpact>(`/api/pages/impact?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`);
