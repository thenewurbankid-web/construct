// Pure (DOMAIN-001, no runtime imports) — maps a click in the live preview
// (a `data-cx-src="file:line:col"` value written by the core annotator) onto
// a node of the parsed page tree.
import { isOpenPage, parseCxSrc } from './CxSrc.ts';

type Positioned = { id: string; line?: number; column?: number; children: Positioned[] };

export function findNodeAtPosition<T extends Positioned>(roots: T[], line: number, column: number): T | null {
  for (const r of roots) {
    if (r.line === line && r.column === column) return r;
    const hit = findNodeAtPosition(r.children as T[], line, column);
    if (hit) return hit;
  }
  return null;
}

export type PreviewSelectResult =
  | { kind: 'selected'; nodeId: string }
  | { kind: 'other-file'; file: string }
  | { kind: 'stale' } // right file, but no element at that position (preview not yet reloaded after an edit)
  | { kind: 'invalid' };

export function resolvePreviewSelection<T extends Positioned>(
  src: unknown,
  roots: T[],
  feature: string,
  file: string,
): PreviewSelectResult {
  const parsed = parseCxSrc(src);
  if (!parsed) return { kind: 'invalid' };
  if (!isOpenPage(parsed.file, feature, file)) return { kind: 'other-file', file: parsed.file };
  const node = findNodeAtPosition(roots, parsed.line, parsed.column);
  return node ? { kind: 'selected', nodeId: node.id } : { kind: 'stale' };
}
