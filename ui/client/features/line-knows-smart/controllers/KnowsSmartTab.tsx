'use client';

import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { KnowsSmartPanel } from '../pages/KnowsSmartPanel';
import { useKnowsSmart } from '../hooks/useKnowsSmart';

/** The How smart is it tab of "What Line knows". */
export function KnowsSmartTab(props: KnowsTabProps) {
  const screen = useKnowsSmart(props);
  return <KnowsSmartPanel screen={screen} />;
}
