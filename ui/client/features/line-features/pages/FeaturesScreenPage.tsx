import { cloneElement, type ReactElement, type ReactNode } from 'react';

type FeaturesScreenPageProps = { phase: 'loading' | 'line' | 'not-line'; screen: ReactElement<{ stage?: ReactNode }>; stage: ReactNode };

/** The Features screen: a Line project gets `stage` (the Line chat) inside the route's screen; while the project is
 * read, and for any other project, the screen is shown as it is. */
export function FeaturesScreenPage({ phase, screen, stage }: FeaturesScreenPageProps) {
  if (phase !== 'line') return screen;
  return cloneElement(screen, { stage });
}
