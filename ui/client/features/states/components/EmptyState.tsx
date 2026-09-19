import type { EmptyStateProps } from '../types';
import { StateCard } from './StateCard';

/** Nothing here yet: says what is missing and what to do next. */
export function EmptyState({ title, hint, actions, size, children }: EmptyStateProps) {
  return (
    <StateCard tone="empty" testId="state-empty" size={size} title={title} hint={hint} actions={actions}>
      {children}
    </StateCard>
  );
}
