import type { ReactNode } from 'react';
import { LoadingState } from '@/features/states';
import type { LinePagesView } from '../types';
import { LinePagesPage } from './LinePagesPage';

/** Two modes, Under the hood: the Line Pages screen once it has read where the chat is (?feature=, ?page=). */
export function PagesHoodPage({ ready, view, panel }: { ready: boolean; view: LinePagesView; panel: ReactNode }) {
  if (!ready) return <LoadingState size="inline" label="Opening Pages" />;
  return <LinePagesPage view={view} panel={panel} />;
}
