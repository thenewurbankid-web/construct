'use client';

import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { KnowsMapPanel } from '../pages/KnowsMapPanel';
import { useKnowsMap } from '../hooks/useKnowsMap';

/** The Map tab of "What Line knows". */
export function KnowsMapTab(props: KnowsTabProps) {
  const screen = useKnowsMap(props);
  return <KnowsMapPanel screen={screen} />;
}
