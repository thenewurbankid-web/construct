'use client';

import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { MemorySoon } from '../components/MemorySoon';
import { useMemorySoon } from '../hooks/useMemorySoon';

/** The Memory tab of "What Line knows" (slot: replaced by the tab's own build). */
export function KnowsMemoryTab(props: KnowsTabProps) {
  const sentence = useMemorySoon(props);
  return <MemorySoon sentence={sentence} />;
}
