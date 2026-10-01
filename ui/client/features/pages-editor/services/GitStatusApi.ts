import { getJson } from '@/lib/http';

export type PageGitStatus = { ok: boolean; path: string; changed: boolean };

/** GET /api/pages/git-status (#829): whether the open page file differs from `main`. */
export const getPageGitStatus = (feature: string, file: string) =>
  getJson<PageGitStatus>(`/api/pages/git-status?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`);
