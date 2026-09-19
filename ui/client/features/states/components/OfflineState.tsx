import type { OfflineStateProps } from '../types';
import { StateCard } from './StateCard';

/** The local model is not reachable. Not an error: deterministic steps still
 * work, so the copy says so and offers the Local Model screen. */
export function OfflineState({ title = 'Local model is offline', hint = 'Deterministic steps still work. Model steps are paused.', settingsHref = '/ollama', actions, size, children }: OfflineStateProps) {
  return (
    <StateCard
      tone="offline"
      testId="state-offline"
      role="status"
      size={size}
      title={title}
      hint={hint}
      actions={actions ?? [{ label: 'Open Local Model', href: settingsHref }]}
      lead={<span className="st-icon" aria-hidden="true">○</span>}
    >
      {children}
    </StateCard>
  );
}
