import type { ReactNode } from 'react';
import { LoadingState } from '@/features/states';
import type { LinePagesView } from '../types';
import { LinePagesPage } from './LinePagesPage';

type PagesScreenPageProps = { phase: 'loading' | 'line' | 'not-line'; view: LinePagesView; fallback: ReactNode; panel: ReactNode };

/** /pages: a short "Opening Pages" while the project is read, the Line Pages screen for a Line project, and the
 * given fallback (today's Pages editor) for any other project. */
export function PagesScreenPage({ phase, view, fallback, panel }: PagesScreenPageProps) {
  if (phase === 'loading') return <LoadingState size="inline" label="Opening Pages" />;
  if (phase === 'not-line') return <>{fallback}</>;
  return <LinePagesPage view={view} panel={panel} />;
}
