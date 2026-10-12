'use client';

import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { ChangeSoon } from '../components/ChangeSoon';
import { useChangeSoon } from '../hooks/useChangeSoon';

/** The Change tab of "What Line knows" (slot: replaced by the tab's own build). */
export function KnowsChangeTab(props: KnowsTabProps) {
  const sentence = useChangeSoon(props);
  return <ChangeSoon sentence={sentence} />;
}
