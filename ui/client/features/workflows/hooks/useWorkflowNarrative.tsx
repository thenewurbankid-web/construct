'use client';

import { useEffect, useState } from 'react';
import { toNarrativeView } from '../domain/InlineText';
import { getWorkflowNarrative } from '../services/WorkflowNarrativeApi';
import type { NarrativeView, WorkflowFileMachines } from '../types';

/** The plain-English narrative for the open workflow file. Re-fetched whenever
 * `loaded` changes identity — first load, "Re-read from source" and every
 * confirmed visual edit all produce a fresh `loaded`, so the English can never
 * lag behind the diagram. Nothing is cached or stored. */
export function useWorkflowNarrative(feature: string, file: string, loaded: WorkflowFileMachines | null): NarrativeView | null {
  const [narrative, setNarrative] = useState<NarrativeView | null>(null);

  useEffect(() => {
    if (!loaded || loaded.error || !feature || !file) {
      setNarrative(null);
      return undefined;
    }
    let live = true;
    getWorkflowNarrative(feature, file)
      .then((r) => {
        if (live) setNarrative(r.ok === false || !r.machines ? null : toNarrativeView(r));
      })
      .catch(() => {
        if (live) setNarrative(null);
      });
    return () => {
      live = false;
    };
  }, [feature, file, loaded]);

  return narrative;
}
