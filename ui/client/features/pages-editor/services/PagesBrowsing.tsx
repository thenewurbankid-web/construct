import { getJson } from '@/lib/http';
import type { PageTree } from '../types';

// Scoped server-side to features/<feature>/pages/ (see
// ui/server/src/pagesEditor.mjs).
export const getFeatures = () => getJson<{ features: string[] }>('/api/pages/features');

export const getPages = (feature: string) => getJson<{ files: string[] }>(`/api/pages?feature=${encodeURIComponent(feature)}`);

export const getPageTree = (feature: string, file: string) =>
  getJson<PageTree & { error?: string }>(`/api/pages/tree?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`);

/** Every page of the project (all features), for the Browser's list on the Pages screen (#431). */
export const getAllPages = () => getJson<{ ok: boolean; pages?: { feature: string; file: string }[]; error?: string }>('/api/pages/all');
