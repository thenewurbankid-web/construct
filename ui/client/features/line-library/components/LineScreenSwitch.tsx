import type { ReactNode } from 'react';
import { LoadingState } from '@/features/states';
import type { LineScreen } from '../types';

/** Renders what screenFor chose: a loading note, the fallback (today's Components screen) or the Line screen (the
 * library in its two modes). */
export function LineScreenSwitch({ screen, fallback, line }: { screen: LineScreen; fallback: ReactNode; line: ReactNode }) {
  if (screen.kind === 'loading') return <LoadingState label="Reading the project" size="inline" />;
  if (screen.kind === 'fallback') return <>{fallback}</>;
  return <>{line}</>;
}
