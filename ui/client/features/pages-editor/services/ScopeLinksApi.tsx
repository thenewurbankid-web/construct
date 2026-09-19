import { getJson } from '@/lib/http';
import type { ScopeLinkGraph } from '../types';

// Path-scoped server-side to features/<feature>/pages/ (see ui/server/src/pagesEditor.mjs).
export const getScopeLinks = (feature: string, file: string, nodeId: string) =>
  getJson<ScopeLinkGraph & { ok?: boolean; error?: string }>(
    `/api/pages/scope-links?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`,
  );
