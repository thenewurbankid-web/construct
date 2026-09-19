// Pure (DOMAIN-001) — turns the server's diagnostics into the editor-neutral
// markers a SourceEditor renders, and summarizes them for the panel header.
// No editor library types here: a Monaco (or any other) adapter maps these
// plain markers onto its own API, so the editor stays replaceable.

import type { DiagnosticSummary, DiagnosticSeverity, SourceDiagnostic, SourceMarker } from '../types';

/** Clamp a range to the document so an adapter never receives a position
 * outside the text (the file may have changed since the diagnostics ran). */
function clampRange(d: SourceDiagnostic, lineCount: number): Pick<SourceMarker, 'startLine' | 'startColumn' | 'endLine' | 'endColumn'> {
  const startLine = Math.min(Math.max(1, d.line), lineCount);
  const endLine = Math.min(Math.max(startLine, d.endLine), lineCount);
  const startColumn = Math.max(1, d.column);
  let endColumn = Math.max(1, d.endColumn);
  if (endLine === startLine && endColumn <= startColumn) endColumn = startColumn + 1;
  return { startLine, startColumn, endLine, endColumn };
}

export function diagnosticsToMarkers(diagnostics: SourceDiagnostic[], source: string): SourceMarker[] {
  const lineCount = Math.max(1, source.split('\n').length);
  return diagnostics.map((d) => ({
    severity: d.severity,
    message: d.message,
    code: d.code,
    source: d.source,
    ...clampRange(d, lineCount),
  }));
}

export function summarizeDiagnostics(diagnostics: SourceDiagnostic[]): DiagnosticSummary {
  const count = (s: DiagnosticSeverity) => diagnostics.filter((d) => d.severity === s).length;
  return { errors: count('error'), warnings: count('warning'), infos: count('info'), total: diagnostics.length };
}

export function describeSummary(s: DiagnosticSummary): string {
  if (s.total === 0) return 'No problems found';
  const parts: string[] = [];
  if (s.errors) parts.push(`${s.errors} error${s.errors === 1 ? '' : 's'}`);
  if (s.warnings) parts.push(`${s.warnings} warning${s.warnings === 1 ? '' : 's'}`);
  if (s.infos) parts.push(`${s.infos} note${s.infos === 1 ? '' : 's'}`);
  return parts.join(', ');
}
