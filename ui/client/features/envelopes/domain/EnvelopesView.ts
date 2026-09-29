// Pure (DOMAIN-001): the run state turned into exactly what the Envelopes tab renders.
import type { EnvelopesState, EnvelopesViewModel } from '../types';

function summaryFor(state: EnvelopesState, shown: number): string {
  if (state.status === 'idle') return 'Not read yet';
  if (!shown && state.status === 'running') return 'Reading saved flows...';
  if (!shown && state.status === 'error') return 'Could not read saved flows';
  return `${shown} saved flow${shown === 1 ? '' : 's'}`;
}

export function buildEnvelopesView(state: EnvelopesState): EnvelopesViewModel {
  const mode = state.status === 'error' && !state.rows.length ? 'error' : state.status === 'ready' && state.rows.length === 0 ? 'empty' : 'list';
  return {
    mode,
    summary: summaryFor(state, state.rows.length),
    running: state.status === 'running',
    error: state.error,
    rows: state.rows,
  };
}
