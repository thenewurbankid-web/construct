import { getJson, postJson } from '@/lib/http';
import type { PageTree, PropData, SaveOutcome } from '../types';

// Every one of these is scoped server-side to features/<feature>/pages/
// (see ui/server/src/pagesEditor.mjs) — the client never enforces that
// itself, only renders what comes back.
export const getFeatures = () => getJson<{ features: string[] }>('/api/pages/features');

export const getPages = (feature: string) => getJson<{ files: string[] }>(`/api/pages?feature=${encodeURIComponent(feature)}`);

export const getPageTree = (feature: string, file: string) =>
  getJson<PageTree & { error?: string }>(`/api/pages/tree?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`);

export const getNodeSnippet = (feature: string, file: string, nodeId: string) =>
  getJson<{ snippet: string; contentHash: string }>(
    `/api/pages/node?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`,
  );

export const saveNodeSnippet = (body: { feature: string; file: string; nodeId: string; snippet: string; contentHash: string }) =>
  postJson<SaveOutcome & PageTree>('/api/pages/node', body);

export const getNodeProps = (feature: string, file: string, nodeId: string) =>
  getJson<{ props: PropData[] }>(
    `/api/pages/props?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`,
  );

export const saveNodeProp = (body: { feature: string; file: string; nodeId: string; propName: string; kind: string; value: unknown; contentHash: string }) =>
  postJson<SaveOutcome & PageTree>('/api/pages/props', body);

export const getUnmappedProps = (feature: string, file: string, nodeId: string) =>
  getJson<{ candidates: string[] }>(
    `/api/pages/unmapped?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`,
  );

export const applyAutoMap = (body: { feature: string; file: string; nodeId: string; propNames: string[]; contentHash: string }) =>
  postJson<SaveOutcome & PageTree>('/api/pages/automap', body);
