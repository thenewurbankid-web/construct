'use client';

import { useSyncExternalStore } from 'react';
import { startRun } from '../domain/AutoRun';
import { DEFAULT_SETTINGS, parseSettings, withHistory } from '../domain/TraceSettings';
import type { AutoAction, TraceSettings } from '../types';

// Trace and Auto settings for this browser tab (sessionStorage): the modes, the request, the person's "let Auto
// approve" (off until they turn it on; it ends with the tab), the speed, the run history and a run in progress, so they
// carry over from screen to screen. The snapshot is cached: useSyncExternalStore needs the same object until it changes.
const KEY = 'cockpit.line-trace';
let snapshot: TraceSettings | null = null;
const listeners = new Set<() => void>();

function read(): TraceSettings {
  if (snapshot) return snapshot;
  try {
    snapshot = parseSettings(window.sessionStorage.getItem(KEY));
  } catch {
    snapshot = DEFAULT_SETTINGS;
  }
  return snapshot;
}

/** Change the settings; every Trace bar on the page follows. */
export function updateTraceSettings(change: (s: TraceSettings) => TraceSettings): void {
  const next = change(read());
  if (next === snapshot) return;
  snapshot = next;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage off: the settings still hold for this page.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Start Auto on `script` for `request`: the same player, moves and stops as the Trace bar's "Do it" (it stops at
 * Approve, Create or Bring it in unless the person lets Auto approve in this session), shown with the cursor when Trace
 * is on. A screen's chat helper fills its questions this way. */
export function startAutoRun(request: string, script: AutoAction[]): void {
  const id = `run-${Date.now().toString(36)}`;
  updateTraceSettings((s) => ({ ...s, run: startRun(id, request, script, s.trace), history: withHistory(s.history, { id, request, script, at: new Date().toISOString() }) }));
}

const serverSnapshot = () => DEFAULT_SETTINGS;

/** The tab's Trace settings. */
export function useTraceSettings(): TraceSettings {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}
