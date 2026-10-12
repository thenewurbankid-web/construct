'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isLineMock } from '@/lib/lineMode';
import { lineKnowsHttp } from '@/lib/lineKnowsHttp';
import type { KnowsHttp, KnowsTabId } from '@/lib/lineKnowsContract';
import { KNOWS_TABS, knowsMessage, knowsOptions, tabFromQuery, tabOfOption } from '../domain/KnowsTabs';
import type { KnowsScreen } from '../types';

const readQuery = (k: string) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(k));

/** The shell of "What Line knows": the open tab (kept in ?tab=, with ?focus= for the item), the page's http (the mock
 * in mock mode) and the chat's options. */
export function useLineKnows(): KnowsScreen {
  const [mock] = useState(isLineMock);
  const [http, setHttp] = useState<KnowsHttp | null>(mock ? null : lineKnowsHttp);
  const [tab, setTabState] = useState<KnowsTabId>(() => tabFromQuery(readQuery('tab')));
  const [focus, setFocus] = useState<string | null>(() => readQuery('focus'));
  useEffect(() => {
    if (!mock) return;
    let live = true;
    void import('@/lib/lineKnowsMock').then((m) => { if (live) setHttp(m.mockKnowsHttp); });
    return () => { live = false; };
  }, [mock]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    q.set('tab', tab);
    if (focus) q.set('focus', focus); else q.delete('focus');
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  }, [tab, focus]);
  const goTo = useCallback((next: KnowsTabId, nextFocus?: string | null) => {
    setTabState(next);
    if (nextFocus !== undefined) setFocus(nextFocus);
  }, []);
  const onOption = useCallback((id: string) => { const t = tabOfOption(id); if (t) setTabState(t); }, []);
  const messages = useMemo(() => [knowsMessage(tab, mock)], [tab, mock]);
  return { tabs: KNOWS_TABS, tab, focus, http, mock, options: knowsOptions(tab), messages, setTab: setTabState, onOption, onFocus: setFocus, goTo };
}
