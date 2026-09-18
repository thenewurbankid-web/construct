import { postJson } from '@/lib/http';

// Ticket F.3 (#122, epic #119) — the visual composer's structural node
// edits (remove/move/add-child). Split into its own file (rather than
// SnippetFlowApi.tsx) purely to stay under MODULE-001's 3-primary-exports-
// per-file budget — same "pure snippet text in, rewritten text or a
// rejection reason out, never a disk write" contract as SnippetFlowApi's
// rewireSnippetWire.

export const removeSnippetNode = (body: { snippet: string; nodeId: string }) =>
  postJson<{ ok: boolean; snippet?: string; error?: string }>('/api/pages/snippet-remove-node', body);

export const moveSnippetNode = (body: { snippet: string; nodeId: string; direction: 'up' | 'down' }) =>
  postJson<{ ok: boolean; snippet?: string; error?: string }>('/api/pages/snippet-move-node', body);

export const addSnippetChild = (body: { snippet: string; parentId: string }) =>
  postJson<{ ok: boolean; snippet?: string; error?: string }>('/api/pages/snippet-add-child', body);
