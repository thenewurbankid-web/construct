import type { AiStepsState, AiStepsView } from '../types';

/** The panel's view of the state: loading, the refusal sentence, or the reason link sentence with the steps. */
export function aiStepsView(state: AiStepsState): AiStepsView {
  if (state.phase === 'loading') return { status: 'Reading the AI steps.', rows: [] };
  if (state.phase === 'error') return { status: state.sentence, rows: [] };
  return { status: state.profiles.reason.sentence, rows: state.rows };
}
