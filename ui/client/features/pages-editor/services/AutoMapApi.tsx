import { getJson, postJson } from '@/lib/http';
import type { PageTree, SaveOutcome } from '../types';

export const getUnmappedProps = (feature: string, file: string, nodeId: string) =>
  getJson<{ candidates: string[] }>(
    `/api/pages/unmapped?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`,
  );

export const applyAutoMap = (body: { feature: string; file: string; nodeId: string; propNames: string[]; contentHash: string }) =>
  postJson<SaveOutcome & PageTree>('/api/pages/automap', body);
