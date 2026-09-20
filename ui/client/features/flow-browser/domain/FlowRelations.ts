import type { FlowRow, Relation } from '../types.ts';

/** The file a row is imported BY in the tree: its parent's file, skipping branch headings (a route is
 * not a file the selection "uses", so it is never a parent here). */
function parentFile(row: FlowRow, byId: Map<string, FlowRow>): string | null {
  let p = row.parentId ? byId.get(row.parentId) : undefined;
  while (p && p.kind === 'branch') p = p.parentId ? byId.get(p.parentId) : undefined;
  return p && (p.kind === 'controller' || p.kind === 'node') ? p.file : null;
}

function closure(start: string, edges: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    for (const next of edges.get(stack.pop() as string) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  seen.delete(start);
  return seen;
}

function addEdge(map: Map<string, Set<string>>, a: string, b: string): void {
  const set = map.get(a) ?? new Set<string>();
  set.add(b);
  map.set(a, set);
}

/** For a selected row: which FILES the selection uses (its imports, transitively) and which use it.
 * Worked out on files, so a file drawn under two routes is tagged wherever it appears. */
export function relationsFor(rows: FlowRow[], selectedId: string | null): Map<string, Relation> {
  const result = new Map<string, Relation>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const selected = selectedId ? byId.get(selectedId) : undefined;
  if (!selected || !selected.file || selected.kind === 'route' || selected.kind === 'branch') return result;
  const down = new Map<string, Set<string>>();
  const up = new Map<string, Set<string>>();
  for (const row of rows) {
    if ((row.kind !== 'controller' && row.kind !== 'node') || !row.file) continue;
    const from = parentFile(row, byId);
    if (!from || from === row.file) continue;
    addEdge(down, from, row.file);
    addEdge(up, row.file, from);
  }
  for (const f of closure(selected.file, down)) result.set(f, 'uses');
  for (const f of closure(selected.file, up)) if (!result.has(f)) result.set(f, 'usedBy');
  return result;
}
