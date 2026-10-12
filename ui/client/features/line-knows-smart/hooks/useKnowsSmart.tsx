'use client';

import { useEffect, useState } from 'react';
import type { KnowsTabProps, SmartTabView } from '@/lib/lineKnowsContract';
import { smartTab } from '../domain/SmartCards';

export type KnowsSmartScreen = { view: SmartTabView | null; error: string | null; showOnMap: (itemId: string) => void };

/** "How smart is it": the numbers from GET /api/line/graph/stats (local records only), as cards. */
export function useKnowsSmart({ http, goTo }: KnowsTabProps): KnowsSmartScreen {
  const [view, setView] = useState<SmartTabView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void http.stats().then((r) => {
      if (!live) return;
      if (r && r.ok) { setView(smartTab(r)); setError(null); } else setError(r?.sentence ?? 'Cockpit could not measure this project.');
    }, () => { if (live) setError('The Cockpit server did not answer.'); });
    return () => { live = false; };
  }, [http]);
  return { view, error, showOnMap: (id) => goTo('map', id) };
}
