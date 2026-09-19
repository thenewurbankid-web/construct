// Pure (DOMAIN-001): reading `construct validate` violations.
import type { PageTarget, Severity, SeverityCounts, Violation } from '../types.ts';

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function severityCounts(violations: Violation[]): SeverityCounts {
  const counts = { error: 0, warning: 0, info: 0, total: violations.length };
  for (const v of violations) if (v.severity in counts) counts[v.severity] += 1;
  return counts;
}

/** Errors first, then warnings, then info; ties by file and line. Does not mutate. */
export function sortViolations(violations: Violation[]): Violation[] {
  return violations.slice().sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
}

const PAGE_FILE = /(?:^|\/)features\/([^/]+)\/pages\/(.+\.[jt]sx?)$/;

/** The Pages editor target for a page file path (`features/<feature>/pages/<file>`), else null. */
export function pageTarget(file: string): PageTarget | null {
  const m = PAGE_FILE.exec(file.replace(/\\/g, '/'));
  return m ? { feature: m[1], file: m[2] } : null;
}
