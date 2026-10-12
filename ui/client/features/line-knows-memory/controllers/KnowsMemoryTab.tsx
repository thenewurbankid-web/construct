'use client';

import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { MemoryTabPanel } from '../components/MemoryTabPanel';
import { useMemoryTab } from '../hooks/useMemoryTab';

/** The Memory tab of "What Line knows": what Line remembered per AI step; edit, forget, export, import, embeddings. */
export function KnowsMemoryTab(props: KnowsTabProps) {
  const screen = useMemoryTab(props);
  return <MemoryTabPanel screen={screen} />;
}
