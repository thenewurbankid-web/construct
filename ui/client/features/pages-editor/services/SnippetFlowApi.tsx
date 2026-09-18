import { postJson } from '@/lib/http';
import type { PagesEditorNode } from '../types';

// Split out of SnippetApi.tsx (MODULE-001 — 3-primary-exports-per-file
// budget) once F.2 added a second call here. All of these are pure text
// in/out for the visual composer: no feature/file/nodeId, no disk access —
// callers pass the snippet's own current text and get back either a fresh
// parse (F.1) or a rewritten snippet to hand to the existing save-back +
// diff-preview flow (F.2+), never a direct write.

/** Ticket F.1 (#120, epic #119) — the visual composer's live graph, a
 * fresh parse of the text currently in the editor every time (never a
 * cached layout). */
export const parseSnippetTree = (snippet: string) =>
  postJson<{ roots: PagesEditorNode[]; error: string | null }>('/api/pages/snippet-tree', { snippet });

/** Ticket F.2 (#121, epic #119) — the visual composer's wire-rewrite: moves
 * an existing prop from one child to a sibling, returning the rewritten
 * snippet text (or a rejection reason) for the caller to hand to the
 * existing save-back-to-source + diff-preview flow itself. */
export const rewireSnippetWire = (body: { snippet: string; parentId: string; propName: string; fromChildId: string; toChildId: string }) =>
  postJson<{ ok: boolean; snippet?: string; error?: string }>('/api/pages/snippet-rewire', body);
