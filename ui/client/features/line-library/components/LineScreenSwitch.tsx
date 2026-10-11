import type { ReactNode } from 'react';
import { LoadingState } from '@/features/states';
import { LineLibraryPage } from '../pages/LineLibraryPage';
import type { ChangeControls, LineScreen } from '../types';

/** Renders what screenFor chose: a loading note, the fallback (today's Components screen) or the Line library. */
export function LineScreenSwitch({ screen, fallback, controls, panel }: { screen: LineScreen; fallback: ReactNode; controls: ChangeControls; panel: ReactNode }) {
  if (screen.kind === 'loading') return <LoadingState label="Reading the project" size="inline" />;
  if (screen.kind === 'fallback') return <>{fallback}</>;
  return <LineLibraryPage view={screen.view} controls={controls} panel={panel} />;
}
