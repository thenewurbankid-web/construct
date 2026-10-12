'use client';

import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { KnowsChangePanel } from '../pages/KnowsChangePanel';
import { useKnowsChange } from '../hooks/useKnowsChange';

/** The Change tab of "What Line knows". */
export function KnowsChangeTab(props: KnowsTabProps) {
  const screen = useKnowsChange(props);
  return <KnowsChangePanel screen={screen} />;
}
