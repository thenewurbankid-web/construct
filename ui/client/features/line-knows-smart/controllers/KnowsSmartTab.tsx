'use client';

import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { SmartSoon } from '../components/SmartSoon';
import { useSmartSoon } from '../hooks/useSmartSoon';

/** The How smart is it tab of "What Line knows" (slot: replaced by the tab's own build). */
export function KnowsSmartTab(props: KnowsTabProps) {
  const sentence = useSmartSoon(props);
  return <SmartSoon sentence={sentence} />;
}
