// Pure (DOMAIN-001): the run state turned into exactly what the Diagnostics tab renders.
import type { DiagnosticRow, DiagnosticsState, DiagnosticsViewModel, Severity, Violation } from '../types.ts';
import { headline } from './DiagnosticsSummary.ts';
import { pageTarget, severityCounts, sortViolations } from './Violations.ts';

/** Plain-language severity for people who do not read rule ids. */
export function severityLabel(severity: Severity): string {
  return severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Note';
}

function rowFor(v: Violation, i: number): DiagnosticRow {
  const target = pageTarget(v.file);
  const label = severityLabel(v.severity);
  return {
    key: `${v.rule}|${v.file}|${v.line}|${i}`,
    severity: v.severity,
    severityLabel: label,
    rule: v.rule,
    message: v.message,
    location: `${v.file}:${v.line}`,
    target,
    line: v.line,
    ariaLabel: `${label} ${v.rule}: ${v.message} ${v.file} line ${v.line}${target ? '. Opens in the Pages editor' : ''}`,
    why: v.why,
    fix: v.suggestedFix,
  };
}

function summaryFor(state: DiagnosticsState, shown: number): string {
  if (state.status === 'idle') return 'Not run yet';
  if (!shown && state.status === 'running') return 'Checking the project...';
  if (!shown && state.status === 'error') return 'Could not check the project';
  const text = headline(severityCounts(state.violations));
  return state.truncated ? `${text} (first ${shown} of ${state.total} shown)` : text;
}

export function buildDiagnosticsView(state: DiagnosticsState): DiagnosticsViewModel {
  const rows = sortViolations(state.violations).map(rowFor);
  const mode = state.status === 'error' && !rows.length ? 'error' : state.status === 'ready' && state.total === 0 ? 'clean' : 'list';
  return {
    summary: summaryFor(state, rows.length),
    mode,
    running: state.status === 'running',
    duration: state.status === 'ready' && state.durationMs !== null ? `${state.durationMs} ms` : null,
    error: state.error,
    rows,
  };
}
