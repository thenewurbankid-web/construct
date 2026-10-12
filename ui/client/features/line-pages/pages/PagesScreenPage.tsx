import type { ReactNode } from 'react';
import { LoadingState } from '@/features/states';

type PagesScreenPageProps = { phase: 'loading' | 'line' | 'not-line'; line: ReactNode; fallback: ReactNode };

/** /pages: a short "Opening Pages" while the project is read, the Line Pages screen (in its two modes) for a Line
 * project, and the given fallback (today's Pages editor) for any other project. */
export function PagesScreenPage({ phase, line, fallback }: PagesScreenPageProps) {
  if (phase === 'loading') return <LoadingState size="inline" label="Opening Pages" />;
  if (phase === 'not-line') return <>{fallback}</>;
  return <>{line}</>;
}
