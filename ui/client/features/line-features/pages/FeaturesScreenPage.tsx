import { cloneElement, type ReactElement, type ReactNode } from 'react';

type FeaturesScreenPageProps = { phase: 'loading' | 'line' | 'not-line'; screen: ReactElement<{ stage?: ReactNode }>; stage?: ReactNode; line?: ReactNode };

/** The Features screen. With `line` (the controller's Line screen): shown once the project is known to be a Line
 * project. With `stage`: the route's screen with that stage in it. Otherwise (reading, or not a Line project) the
 * route's screen as it is. */
export function FeaturesScreenPage({ phase, screen, stage, line }: FeaturesScreenPageProps) {
  if (phase !== 'line') return screen;
  if (line) return <>{line}</>;
  return cloneElement(screen, { stage });
}
