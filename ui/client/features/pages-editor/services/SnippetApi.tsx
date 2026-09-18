import { getJson, postJson } from '@/lib/http';
import type { PageTree, SaveOutcome } from '../types';

export const getNodeSnippet = (feature: string, file: string, nodeId: string) =>
  getJson<{ snippet: string; contentHash: string }>(
    `/api/pages/node?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`,
  );

export const saveNodeSnippet = (body: { feature: string; file: string; nodeId: string; snippet: string; contentHash: string }) =>
  postJson<SaveOutcome & PageTree>('/api/pages/node', body);
