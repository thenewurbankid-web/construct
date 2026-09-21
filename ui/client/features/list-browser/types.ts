import type { ReactNode } from 'react';
import type { StateAction } from '@/features/states';

/** One row of a Browser-pane list. `id` is what the URL and the caller use; `label` and `detail` are what is shown. */
export type ListItem = { id: string; label: string; detail?: string };

export type ListStatus = 'loading' | 'error' | 'ready';

export type ListBrowserProps = {
  /** Accessible name of the list ("Features"). */
  label: string;
  /** Accessible name of the filter box ("Filter features"). */
  filterLabel: string;
  items: ListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  status: ListStatus;
  /** Plain-language reason when `status` is 'error'; `onRetry` is its one next action. */
  error?: string;
  onRetry?: () => void;
  /** Shown when the project has none of these at all: what is missing and the one next action. */
  emptyTitle: string;
  emptyHint?: string;
  emptyAction?: StateAction;
  /** Stable prefix for data-testid values (`<testId>`, `<testId>-filter`, `<testId>-item`). */
  testId: string;
  /** Optional slot above the filter. */
  header?: ReactNode;
};
