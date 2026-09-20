import type { CodeSegment, NavReference } from '../types';

// Pure (DOMAIN-001): which references in a file are links (#321).

/**
 * Split `source` into runs of text, marking only references that RESOLVED to a project file. A
 * reference with no target contributes nothing: it stays inside an ordinary text run, so it has no
 * link markup to render (#321: unresolved references are plain text, decided when the file draws,
 * never on click).
 */
export function linkSegments(source: string, references: NavReference[]): CodeSegment[] {
  const links = references
    .filter((r) => r.target !== null && r.end > r.start && r.start >= 0 && r.end <= source.length)
    .sort((a, b) => a.start - b.start);
  const out: CodeSegment[] = [];
  let at = 0;
  for (const ref of links) {
    if (ref.start < at) continue; // overlapping candidates: first wins
    if (ref.start > at) out.push({ text: source.slice(at, ref.start) });
    out.push({ text: source.slice(ref.start, ref.end), ref });
    at = ref.end;
  }
  if (at < source.length) out.push({ text: source.slice(at) });
  return out;
}

/** References that are not links, one entry each (name + plain reason), de-duplicated by name and reason. */
export function unlinkedReferences(references: NavReference[]): { name: string; line: number; reason: string }[] {
  const seen = new Set<string>();
  const out: { name: string; line: number; reason: string }[] = [];
  for (const r of references) {
    if (r.target !== null || !r.reason) continue;
    const key = `${r.name}|${r.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: r.name, line: r.line, reason: r.reason });
  }
  return out;
}
