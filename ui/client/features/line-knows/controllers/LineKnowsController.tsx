'use client';

import { KnowsMapTab } from '@/features/line-knows-map';
import { KnowsMemoryTab } from '@/features/line-knows-memory';
import { KnowsChangeTab } from '@/features/line-knows-change';
import { KnowsSmartTab } from '@/features/line-knows-smart';
import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { LineKnowsPage } from '../pages/LineKnowsPage';
import { useLineKnows } from '../hooks/useLineKnows';

const TABS = { map: KnowsMapTab, memory: KnowsMemoryTab, change: KnowsChangeTab, smart: KnowsSmartTab };

/** The "What Line knows" screen (/knows): the shell's state from useLineKnows; each tab is its own feature. */
export function LineKnowsController() {
  const screen = useLineKnows();
  const Tab = TABS[screen.tab];
  const props: KnowsTabProps | null = screen.http ? { http: screen.http, focus: screen.focus, onFocus: screen.onFocus, goTo: screen.goTo, mock: screen.mock } : null;
  return <LineKnowsPage screen={screen} panel={props ? <Tab {...props} /> : <p aria-busy="true">Loading what Line knows.</p>} />;
}
