'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuthSession } from '@/features/auth';
import { effectiveMode, modeKey, parseMode, type LineMode } from '@/lib/lineModes';

/** The person's mode (null until they pick one with the switch) and the mounted screen's default. */
export type LineModeValue = {
  stored: LineMode | null;
  /** The mode the shell's switch shows: the person's choice, else the open screen's default, else Under the hood. */
  mode: LineMode;
  setMode: (mode: LineMode) => void;
  setScreenDefault: (mode: LineMode | null) => void;
};

const NONE: LineModeValue = { stored: null, mode: 'hood', setMode: () => {}, setScreenDefault: () => {} };
const LineModeContext = createContext<LineModeValue>(NONE);

function read(key: string): LineMode | null {
  try {
    return parseMode(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key: string, mode: LineMode) {
  try {
    window.localStorage.setItem(key, mode);
  } catch {
    // Storage blocked: the choice lasts until the tab closes.
  }
}

/** Two modes: the person's mode for every screen, remembered per signed-in login (one key per login in this browser;
 * a local Cockpit with no sign-in has one person). Mount once, around the shell. */
export function LineModeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuthSession();
  const key = modeKey(session?.user?.login ?? null);
  const [stored, setStored] = useState<LineMode | null>(null);
  const [screenDefault, setScreenDefault] = useState<LineMode | null>(null);
  useEffect(() => setStored(read(key)), [key]);
  const setMode = useCallback(
    (mode: LineMode) => {
      setStored(mode);
      write(key, mode);
    },
    [key],
  );
  const value = useMemo(() => ({ stored, mode: effectiveMode(stored, screenDefault ?? 'hood'), setMode, setScreenDefault }), [stored, screenDefault, setMode]);
  return <LineModeContext.Provider value={value}>{children}</LineModeContext.Provider>;
}

/** The current mode and the switch. Outside the provider: always Under the hood, and the switch does nothing. */
export function useLineMode(): LineModeValue {
  return useContext(LineModeContext);
}
