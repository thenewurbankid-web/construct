// Pure (DOMAIN-001): which of ia-generate-states' seven states a given prop snapshot is in.
// One function, no component may branch this logic itself.
import type { GenerateControlProps, GenerateMode, GenerateViewState } from '../types.ts';

export function generateViewState(props: GenerateControlProps): GenerateViewState {
  if (props.running) return 'running';
  if (props.result) return 'result';
  if (props.disabledReason) return 'disabled';
  if (!props.mechanical) return 'ai-only';
  if (props.mode === 'ai' && props.modelOffline) return 'refused-offline';
  if (props.mode === 'ai') return 'ai-disclosure';
  return 'idle';
}

/** The mode a control should actually use, folding in the offline-reset rule: AI is never
 * shown as "chosen" while the model is offline, mechanical is offered instead. */
export function effectiveMode(remembered: GenerateMode, props: GenerateControlProps): GenerateMode {
  if (remembered === 'ai' && props.modelOffline) return 'mechanical';
  if (remembered === 'ai' && !props.mechanical) return 'ai';
  if (!props.mechanical) return 'ai';
  return remembered;
}
