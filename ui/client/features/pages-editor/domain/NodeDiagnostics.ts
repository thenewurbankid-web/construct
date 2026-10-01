import type { PagesEditorNode, SourceDiagnostic } from '../types';

// Pure (DOMAIN-001) -- #833's "the selected node's own violations, not the whole file's". A node carries
// only the line of its own opening `<` (no endLine), so its line RANGE is derived as [own line, the last
// line any of its descendants opens on] -- the whole span its JSX subtree can lexically occupy, since a
// child's opening tag always lands after its parent's in the source.

/** The highest `line` among `node` and everything under it (0 when nothing has a line yet). */
function deepestLine(node: PagesEditorNode): number {
  let max = node.line ?? 0;
  for (const child of node.children) max = Math.max(max, deepestLine(child));
  return max;
}

/** Diagnostics whose line falls within `node`'s own subtree span. `[]` when the node has no recorded line. */
export function diagnosticsForNode(node: PagesEditorNode, diagnostics: SourceDiagnostic[]): SourceDiagnostic[] {
  if (node.line === undefined) return [];
  const from = node.line;
  const to = deepestLine(node);
  return diagnostics.filter((d) => d.line >= from && d.line <= to);
}

export const severityLabel = (s: SourceDiagnostic['severity']): string => (s === 'error' ? 'Error' : s === 'warning' ? 'Warning' : 'Note');
