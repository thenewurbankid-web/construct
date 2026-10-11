import type { ReactNode } from 'react';
import { ImportOffer } from '../components/ImportOffer';
import type { LineFeaturesView } from '../types';
import { LineFeaturesPage } from './LineFeaturesPage';

type FeaturesSwitchPageProps = { phase: 'loading' | 'line' | 'not-line'; view: LineFeaturesView; fallback: ReactNode; workflows?: ReactNode };

/** The Line Features view once the project is known to be a Line project; until then, and for any other project, the
 * given fallback (today's Features list and details). Showing the fallback while reading keeps its Browser tab the
 * first one registered, so it stays the tab the Browser opens on (the Notes tab is also preferred). A project that is not
 * a Line project also gets one line offering Import. */
export function FeaturesSwitchPage({ phase, view, fallback, workflows = null }: FeaturesSwitchPageProps) {
  if (phase === 'loading') return <>{fallback}</>;
  if (phase !== 'line') {
    return (
      <>
        <ImportOffer />
        {fallback}
      </>
    );
  }
  return <LineFeaturesPage view={view} workflows={workflows} />;
}
