import { AnimatedLoader } from '@/components/ui';
import type { LoadingStateProps } from '../types';
import { StateCard } from './StateCard';

/** Work in progress: a live-region pill plus a progress bar (indeterminate
 * unless a percentage is known). Reduced motion stops the animation.
 * `animated` (#406) swaps the generic `.st-spinner` for the shared brand AnimatedLoader — opt-in so
 * existing callers are unaffected; it also owns the "status" announcement itself, so it is rendered
 * `decorative` here rather than doubling the label this pill already carries. */
export function LoadingState({ label, hint, percent, actions, size, animated, children }: LoadingStateProps) {
  const known = typeof percent === 'number';
  return (
    <StateCard
      tone="loading"
      testId="state-loading"
      role="status"
      size={size}
      hint={hint}
      actions={actions}
      lead={
        <>
          <span className="st-pill">
            {animated ? <AnimatedLoader size="small" variant="inline" label={label} decorative /> : <span className="st-spinner" aria-hidden="true" />}
            {label}
          </span>
          <span
            className={known ? 'st-bar' : 'st-bar st-bar--indeterminate'}
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={known ? Math.round(percent) : undefined}
          >
            <span className="st-bar-fill" style={known ? { width: `${Math.max(0, Math.min(100, percent))}%` } : undefined} />
          </span>
        </>
      }
    >
      {children}
    </StateCard>
  );
}
