import { getJson, postJson } from '@/lib/http';
import type { PageChange } from '../types';

// #224 — last external change to a page file (server: ui/server/src/pageChanges.mjs).
export const getPageChange = (feature: string, file: string) =>
  getJson<{ ok?: boolean; change: PageChange | null }>(
    `/api/pages/changes?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`,
  );

export const dismissPageChange = (feature: string, file: string) =>
  postJson<{ ok: boolean }>('/api/pages/changes/dismiss', { feature, file });
