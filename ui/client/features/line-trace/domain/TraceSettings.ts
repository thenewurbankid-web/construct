// Pure (DOMAIN-001): the tab's Trace settings as stored, their defaults and the run history.
import type { TraceRun, TraceSettings } from '../types.ts';

const SPEED_VALUES = [0.5, 1, 2];
const HISTORY_SIZE = 10;

export const DEFAULT_SETTINGS: TraceSettings = { trace: false, auto: false, request: '', autoApprove: false, speed: 1, history: [], run: null };

/** The history with a new run first, at most ten kept. */
export function withHistory(history: TraceRun[], run: TraceRun): TraceRun[] {
  return [run, ...history.filter((h) => h.id !== run.id)].slice(0, HISTORY_SIZE);
}

/** The settings as stored for the tab (anything unreadable falls back to the defaults; Auto approval is off unless set). */
export function parseSettings(raw: string | null): TraceSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const v = JSON.parse(raw) as Partial<TraceSettings>;
    return {
      trace: v.trace === true,
      auto: v.auto === true,
      request: typeof v.request === 'string' ? v.request : '',
      autoApprove: v.autoApprove === true,
      speed: SPEED_VALUES.includes(v.speed as number) ? (v.speed as number) : 1,
      history: Array.isArray(v.history) ? v.history.slice(0, HISTORY_SIZE) : [],
      run: v.run && typeof v.run === 'object' && Array.isArray(v.run.script) ? v.run : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
