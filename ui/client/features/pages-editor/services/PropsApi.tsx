import { getJson, postJson } from '@/lib/http';
import type { PageTree, PropData, SaveOutcome } from '../types';

export const getNodeProps = (feature: string, file: string, nodeId: string) =>
  getJson<{ props: PropData[] }>(
    `/api/pages/props?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`,
  );

export const saveNodeProp = (body: {
  feature: string;
  file: string;
  nodeId: string;
  propName: string | null;
  kind: string;
  value: unknown;
  contentHash: string;
  index?: number;
}) => postJson<SaveOutcome & PageTree>('/api/pages/props', body);
