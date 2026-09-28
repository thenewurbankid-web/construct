'use client';

import { useEffect, useState } from 'react';
import { fetchExecutionMode } from '../services/ProjectApi';

/** #541: `'engine'` or `'cli'`, read once the project is known. Null while no project is open, the
 * value is unreadable, or `project.execution.mode` isn't set (the implicit `engine` default —
 * shown as nothing rather than a redundant label). */
export function useExecutionMode(projectKnown: boolean): string | null {
  const [mode, setMode] = useState<string | null>(null);

  useEffect(() => {
    if (!projectKnown) {
      setMode(null);
      return undefined;
    }
    let alive = true;
    fetchExecutionMode().then((m) => {
      if (alive) setMode(m);
    });
    return () => {
      alive = false;
    };
  }, [projectKnown]);

  return mode;
}
