'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadRailCollapsed, saveRailCollapsed } from '../services/RailStorage';

/** Whether the screens rail is collapsed to icons only, remembered per person (this browser). First paint is
 * the expanded rail (matches the server render); the saved choice is applied right after mount. */
export function useRailCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(loadRailCollapsed()), []);
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      saveRailCollapsed(!c);
      return !c;
    });
  }, []);
  return { collapsed, toggle };
}
