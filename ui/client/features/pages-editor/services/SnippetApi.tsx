import { getJson, postJson } from '@/lib/http';
import type { PageTree, PagesEditorNode, SaveOutcome } from '../types';

export const getNodeSnippet = (feature: string, file: string, nodeId: string) =>
  getJson<{ snippet: string; contentHash: string }>(
    `/api/pages/node?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`,
  );

export const saveNodeSnippet = (body: { feature: string; file: string; nodeId: string; snippet: string; contentHash: string }) =>
  postJson<SaveOutcome & PageTree>('/api/pages/node', body);

// Ticket F.1 (#120, epic #119) — the visual composer's live graph. Pure
// text in, tree out: no feature/file/nodeId, no disk access, so it can be
// called on every edit to *any* snippet, isolated or not — always a fresh
// parse of the text currently in the editor, never a cached layout.
export const parseSnippetTree = (snippet: string) =>
  postJson<{ roots: PagesEditorNode[]; error: string | null }>('/api/pages/snippet-tree', { snippet });
