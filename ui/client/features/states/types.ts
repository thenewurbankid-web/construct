import type { ReactNode } from 'react';

export type StateAction = {
  label: string;
  /** Renders a link when `href` is given, a button otherwise. */
  href?: string;
  onClick?: () => void;
  /** The one call to action of the state (accent styling). */
  primary?: boolean;
  disabled?: boolean;
};

type StateBase = {
  title: string;
  /** Plain-language detail: what happened / what will appear / what to do. */
  hint?: string;
  actions?: StateAction[];
  /** `panel` (default) is the padded card; `inline` is compact for use inside a pane or form. */
  size?: 'panel' | 'inline';
  children?: ReactNode;
};

export type EmptyStateProps = StateBase;
export type LoadingStateProps = Omit<StateBase, 'title'> & {
  /** What is loading, shown in the pill ("Loading settings"). */
  label: string;
  /** 0-100 when the work reports progress; omit for an indeterminate bar. */
  percent?: number;
  /** #406: the shared AnimatedLoader (brand mark, `busy` motion) instead of the generic
   * `.st-spinner`. Opt-in per call site — existing callers are unaffected. */
  animated?: boolean;
};
export type ErrorStateProps = StateBase & {
  /** Retry action; shown as the primary button "Try again". */
  onRetry?: () => void;
  retrying?: boolean;
};
export type OfflineStateProps = Omit<StateBase, 'title' | 'hint'> & {
  title?: string;
  hint?: string;
  settingsHref?: string;
};

export type ErrorDescription = { title: string; hint: string };

export type StatesGalleryProps = { retries: number; retrying: boolean; onRetry: () => void };
