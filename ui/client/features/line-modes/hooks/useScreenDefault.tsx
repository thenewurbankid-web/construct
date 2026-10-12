'use client';

import { useEffect } from 'react';
import type { LineMode } from '@/lib/lineModes';
import { useLineMode } from './useLineMode';

/** Tells the shell's switch which mode this screen shows until the person picks one. */
export function useScreenDefault(mode: LineMode) {
  const { setScreenDefault } = useLineMode();
  useEffect(() => {
    setScreenDefault(mode);
    return () => setScreenDefault(null);
  }, [mode, setScreenDefault]);
}
