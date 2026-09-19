import type { ErrorStateProps } from '../types';
import { StateCard } from './StateCard';

/** Something failed: what happened, the fix, and a Try again action when a
 * retry is possible. */
export function ErrorState({ title, hint, onRetry, retrying, actions = [], size, children }: ErrorStateProps) {
  const all = onRetry
    ? [{ label: retrying ? 'Trying again…' : 'Try again', onClick: onRetry, primary: true, disabled: retrying }, ...actions]
    : actions;
  return (
    <StateCard
      tone="error"
      testId="state-error"
      role="alert"
      size={size}
      title={title}
      hint={hint}
      actions={all}
      lead={<span className="st-icon" aria-hidden="true">!</span>}
    >
      {children}
    </StateCard>
  );
}
