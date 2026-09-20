// Pure (DOMAIN-001): the changed-units tree as data, and the keyboard model over it (#351).
//
// The screen shows the same files three ways (by feature then layer, by layer, flat). Each way is built
// here as ONE list of nodes; the component only draws it, and the keyboard model below is the whole
// ARIA tree-view contract (WAI-ARIA Authoring Practices, "Tree View"), independent of React and the DOM:
//
//   Down / Up    the next / previous VISIBLE row          Home / End   the first / last visible row
//   Right        a closed parent opens; an open parent moves to its first child; a leaf does nothing
//   Left         an open parent closes; anything else moves to its parent
//   Enter/Space  a file is selected; a parent toggles
//
// One row is the single tab stop of the whole tree (a roving tabindex): `tabStop()` says which. The nodes
// themselves are built in TreeNodes.ts.
import type { TreeAction, TreeNodeView } from '../types.ts';

/** A row of the tree as it is currently visible (parents' closed children are skipped). */
export type VisibleRow = { id: string; parentId: string | null; expandable: boolean; firstChildId: string | null };

export function flattenVisible(nodes: TreeNodeView[], isOpen: (id: string) => boolean, parentId: string | null = null): VisibleRow[] {
  return nodes.flatMap((n) => [
    { id: n.id, parentId, expandable: n.children.length > 0, firstChildId: n.children[0]?.id ?? null },
    ...(n.children.length > 0 && isOpen(n.id) ? flattenVisible(n.children, isOpen, n.id) : []),
  ]);
}

/** Which row is the tab stop: the active one if it is still visible, else the selected file's, else the first. */
export function tabStop(rows: VisibleRow[], activeId: string | null, selectedId: string | null): string | null {
  if (activeId && rows.some((r) => r.id === activeId)) return activeId;
  if (selectedId && rows.some((r) => r.id === selectedId)) return selectedId;
  return rows[0]?.id ?? null;
}

/** What a key does from row `at`. `null` means the key is not the tree's (let it through). */
export function navigate(key: string, rows: VisibleRow[], at: string, isOpen: (id: string) => boolean): TreeAction | null {
  const i = rows.findIndex((r) => r.id === at);
  if (i < 0) return null;
  const row = rows[i];
  switch (key) {
    case 'ArrowDown': return { focus: rows[Math.min(rows.length - 1, i + 1)].id };
    case 'ArrowUp': return { focus: rows[Math.max(0, i - 1)].id };
    case 'Home': return { focus: rows[0].id };
    case 'End': return { focus: rows[rows.length - 1].id };
    case 'ArrowRight':
      if (!row.expandable) return {};
      return isOpen(row.id) ? { focus: row.firstChildId ?? undefined } : { open: { id: row.id, open: true } };
    case 'ArrowLeft':
      if (row.expandable && isOpen(row.id)) return { open: { id: row.id, open: false } };
      return row.parentId ? { focus: row.parentId } : {};
    case 'Enter':
    case ' ':
      return row.expandable ? { open: { id: row.id, open: !isOpen(row.id) } } : { activate: row.id };
    default:
      return null;
  }
}
