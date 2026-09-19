'use client';

import { useCallback, useState } from 'react';
import type { ShellRegion } from '../types';

/** Remembers which tab is selected per region (a tab that disappears or is
 * disabled falls back to the first enabled one where it is resolved). */
export function useActiveTabs() {
  const [active, setActive] = useState<Record<ShellRegion, string | null>>({ browser: null, tools: null, drawer: null });
  const select = useCallback((region: ShellRegion, id: string) => setActive((a) => ({ ...a, [region]: id })), []);
  return { active, select };
}
