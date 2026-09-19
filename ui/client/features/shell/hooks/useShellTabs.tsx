'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { addTab, removeTab } from '../domain/TabRegistry';
import type { ShellRegion, ShellTab } from '../types';

type Registry = Record<ShellRegion, ShellTab[]>;
type SlotsApi = {
  register: (region: ShellRegion, tab: ShellTab) => void;
  unregister: (region: ShellRegion, id: string) => void;
};

const EMPTY: Registry = { browser: [], tools: [], drawer: [] };
// Two contexts on purpose: registering features only need the stable
// register/unregister pair, so a registry update never re-renders them (that
// would re-register their tab and loop). Only the shell reads the tab lists.
const TabsContext = createContext<Registry>(EMPTY);
const ApiContext = createContext<SlotsApi | null>(null);

/** Holds tabs registered by features. Mounted once by the shell; features call
 * useRegisterShellTab (below) and never touch each other's panels. */
export function ShellTabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Registry>(EMPTY);
  const register = useCallback((region: ShellRegion, tab: ShellTab) => {
    setTabs((t) => ({ ...t, [region]: addTab(t[region], tab) }));
  }, []);
  const unregister = useCallback((region: ShellRegion, id: string) => {
    setTabs((t) => ({ ...t, [region]: removeTab(t[region], id) }));
  }, []);
  const api = useMemo(() => ({ register, unregister }), [register, unregister]);
  return createElement(ApiContext.Provider, { value: api }, createElement(TabsContext.Provider, { value: tabs }, children));
}

/** Tabs registered by features for one region (empty outside the provider). */
export function useShellTabs(region: ShellRegion): ShellTab[] {
  return useContext(TabsContext)[region];
}

/** Registers `tab` in `region` while the calling component is mounted. Calling
 * it again with a changed tab replaces that tab in place (its position is kept),
 * so a feature can pass a fresh tab object whenever its state changes. The
 * tab's `render` runs inside the shell, not in the caller. */
export function useRegisterShellTab(region: ShellRegion, tab: ShellTab): void {
  const api = useContext(ApiContext);
  const { id } = tab;
  useEffect(() => {
    api?.register(region, tab);
  }, [api, region, tab]);
  useEffect(() => {
    return () => api?.unregister(region, id);
  }, [api, region, id]);
}
