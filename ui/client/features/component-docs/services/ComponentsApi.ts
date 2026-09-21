import { getJson, postJson } from '@/lib/http';
import type { ComponentEntry, DescribeResponse, PreviewResponse, SaveResponse, SourceResponse } from '../types';

// Every call names a component by the root-relative path the list gave (the server re-checks it against its own list).
const q = (path: string) => encodeURIComponent(path);

export const getComponents = () => getJson<{ ok: boolean; components?: ComponentEntry[]; error?: string }>('/api/components');

export const getComponentDescription = (path: string) => getJson<DescribeResponse>(`/api/components/describe?path=${q(path)}`);

export const getComponentSource = (path: string) => getJson<SourceResponse>(`/api/components/source?path=${q(path)}`);

/** Preview: the server returns before/after and writes nothing. */
export const previewComponentSave = (path: string, content: string) => postJson<PreviewResponse>('/api/components/save', { path, content });

/** Commit: hash-checked, architecture-gated, written and committed on save by the server. */
export const commitComponentSave = (path: string, content: string, contentHash: string) =>
  postJson<SaveResponse>('/api/components/save', { path, content, contentHash, commit: true });
