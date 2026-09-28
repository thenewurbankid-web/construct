// Pure (DOMAIN-001): the run state turned into exactly what the Rules tab renders.
import type { RulesState, RulesViewModel } from '../types';

function summaryFor(state: RulesState, shown: number): string {
  if (state.status === 'idle') return 'Not read yet';
  if (!shown && state.status === 'running') return 'Reading the project’s rules...';
  if (!shown && state.status === 'error') return 'Could not read the project’s rules';
  const errors = state.rows.filter((r) => r.severity === 'error' && r.count > 0).length;
  const warnings = state.rows.filter((r) => r.severity === 'warning' && r.count > 0).length;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error rule${errors === 1 ? '' : 's'} firing`);
  if (warnings) parts.push(`${warnings} warning rule${warnings === 1 ? '' : 's'} firing`);
  const firing = parts.length ? parts.join(', ') : 'no rules currently firing';
  return `${shown} rule${shown === 1 ? '' : 's'} (${firing})`;
}

export function buildRulesView(state: RulesState): RulesViewModel {
  const mode = state.status === 'error' && !state.rows.length ? 'error' : state.status === 'ready' && state.rows.length === 0 ? 'empty' : 'list';
  return {
    mode,
    summary: summaryFor(state, state.rows.length),
    running: state.status === 'running',
    error: state.error,
    rows: state.rows,
  };
}
