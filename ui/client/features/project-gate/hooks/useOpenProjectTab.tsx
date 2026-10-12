'use client';

import { useCallback, useEffect, useState } from 'react';
import { searchWithTab, shownTab, tabFromSearch } from '../domain/OpenProjectTabUrl';
import type { OpenProjectTab } from '../types';

/** The Open-a-project screen's tab, kept in the URL (`?tab=new`, no new history entry) so the person can come back to
 * it. With none named, "Your projects" shows when there are projects and "New project" when there are none. */
export function useOpenProjectTab(projectCount: number | null) {
  const [chosen, setChosen] = useState<OpenProjectTab | null>(null);
  useEffect(() => {
    setChosen(tabFromSearch(window.location.search));
  }, []);
  const choose = useCallback((tab: OpenProjectTab) => {
    setChosen(tab);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${searchWithTab(window.location.search, tab)}${window.location.hash}`);
  }, []);
  return { tab: shownTab(chosen, projectCount), choose };
}
