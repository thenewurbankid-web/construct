import { getJson, postJson } from '@/lib/http';
import type { ComponentEntry, ComponentWorkflowResponse, DescribeResponse, PreviewResponse, SaveResponse, SourceResponse, UsedByResponse } from '../types';

// Every call names a component by the root-relative path the list gave (the server re-checks it against its own list).
const q = (path: string) => encodeURIComponent(path);

export const getComponents = () => getJson<{ ok: boolean; components?: ComponentEntry[]; error?: string }>('/api/components');

export const getComponentDescription = (path: string) => getJson<DescribeResponse>(`/api/components/describe?path=${q(path)}`);

export const getComponentSource = (path: string) => getJson<SourceResponse>(`/api/components/source?path=${q(path)}`);

/** #380 "Used by": which pages import this component, transitively. */
export const getComponentUsedBy = (path: string) => getJson<UsedByResponse>(`/api/components/used-by?path=${q(path)}`);

/** #380 "State switcher": the workflow machine driving this component, found by the same-name-file convention. */
export const getComponentWorkflow = (path: string) => getJson<ComponentWorkflowResponse>(`/api/components/workflow?path=${q(path)}`);

/** Preview: the server returns before/after and writes nothing. */
export const previewComponentSave = (path: string, content: string) => postJson<PreviewResponse>('/api/components/save', { path, content });

/** Commit: hash-checked, architecture-gated, written and committed on save by the server. */
export const commitComponentSave = (path: string, content: string, contentHash: string) =>
  postJson<SaveResponse>('/api/components/save', { path, content, contentHash, commit: true });
