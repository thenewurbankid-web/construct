'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { addTab, removeTab } from '../domain/TabRegistry';
import type { ShellRegion, ShellTab } from '../types';

type Registry = Record<ShellRegion, ShellTab[]>;
type SlotsApi = {
  tabs: Registry;
  register: (region: ShellRegion, tab: ShellTab) => void;
  unregister: (region: ShellRegion, id: string) => void;
};

const EMPTY: Registry = { browser: [], tools: [], drawer: [] };
const SlotsContext = createContext<SlotsApi | null>(null);

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
  const value = useMemo(() => ({ tabs, register, unregister }), [tabs, register, unregister]);
  return createElement(SlotsContext.Provider, { value }, children);
}

/** Tabs registered by features for one region (empty outside the provider). */
export function useShellTabs(region: ShellRegion): ShellTab[] {
  return useContext(SlotsContext)?.tabs[region] ?? EMPTY[region];
}

/** Registers `tab` in `region` while the calling component is mounted. Pass a
 * memoised tab (its `render` runs inside the shell, not the caller). */
export function useRegisterShellTab(region: ShellRegion, tab: ShellTab): void {
  const api = useContext(SlotsContext);
  useEffect(() => {
    if (!api) return;
    api.register(region, tab);
    return () => api.unregister(region, tab.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, tab, api?.register, api?.unregister]);
}
