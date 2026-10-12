import type { AiStepsState, AiStepsView, MissView } from '../types';

/** The panel's view of the state: loading, the refusal sentence, or the reason link sentence with the steps. */
export function aiStepsView(state: AiStepsState, misses: MissView | null = null): AiStepsView {
  if (state.phase === 'loading') return { status: 'Reading the AI steps.', rows: [], misses };
  if (state.phase === 'error') return { status: state.sentence, rows: [], misses };
  return { status: state.profiles.reason.sentence, rows: state.rows, misses };
}
