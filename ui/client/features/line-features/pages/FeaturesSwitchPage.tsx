import type { ReactNode } from 'react';
import type { LineFeaturesView } from '../types';
import { LineFeaturesPage } from './LineFeaturesPage';

type FeaturesSwitchPageProps = { phase: 'loading' | 'line' | 'not-line'; view: LineFeaturesView; fallback: ReactNode };

/** The given fallback (today's Features list and details) for a project that is not a Line project; otherwise the
 * Line Features view, which says it is reading the project until the project is read. */
export function FeaturesSwitchPage({ phase, view, fallback }: FeaturesSwitchPageProps) {
  if (phase === 'not-line') return <>{fallback}</>;
  return <LineFeaturesPage view={view} reading={phase === 'loading'} />;
}
