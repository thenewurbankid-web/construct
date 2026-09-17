import type { PagesEditorNode } from '../types';

// Pure (DOMAIN-001) — tree-navigation helpers over the already-parsed node
// hierarchy.

export function findNode(roots: PagesEditorNode[], id: string): PagesEditorNode | null {
  for (const r of roots) {
    if (r.id === id) return r;
    const hit = findNode(r.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Maps a node's own id to its *parent's id* (or null for a root). */
export function flattenParentOf(roots: PagesEditorNode[]): Map<string, string | null> {
  const parentOf = new Map<string, string | null>();
  const walk = (nodes: PagesEditorNode[], parentId: string | null) => {
    for (const n of nodes) {
      parentOf.set(n.id, parentId);
      walk(n.children, n.id);
    }
  };
  walk(roots, null);
  return parentOf;
}
