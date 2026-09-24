'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getWorkCount, subscribeWork } from '@/lib/workActivity';

/** How long the indicator keeps going after the last piece of work ends, so a command that answers in 80 ms still shows
 * one visible cycle instead of a flicker. */
export const WORKING_HOLD_MS = 900;

/**
 * Is the framework working right now? True while a mechanical command or the Import Wizard is running (counted where every
 * request already passes, lib/workActivity.ts) or a Process is running (`runningProcesses`, from the Processes drawer's own
 * data). The top-bar brand mark animates only while this is true. Nothing here calls a model or the network.
 */
export function useWorking(runningProcesses: number, holdMs: number = WORKING_HOLD_MS): boolean {
  const counted = useSyncExternalStore(subscribeWork, getWorkCount, () => 0);
  const active = counted > 0 || runningProcesses > 0;
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (active) {
      setHeld(true);
      return undefined;
    }
    const id = setTimeout(() => setHeld(false), holdMs);
    return () => clearTimeout(id);
  }, [active, holdMs]);
  return active || held;
}
