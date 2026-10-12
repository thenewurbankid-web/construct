// Two modes: where a person's mode is kept (this browser's storage, one key per login; lib/lineModes.ts modeKey). Storage
// can be blocked (a private window, a policy): then reads say "not picked" and writes last until the tab closes.
import { parseMode, type LineMode } from '@/lib/lineModes';

export function readMode(key: string): LineMode | null {
  try {
    return parseMode(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeMode(key: string, mode: LineMode): void {
  try {
    window.localStorage.setItem(key, mode);
  } catch {
    // Storage blocked: the choice lasts until the tab closes.
  }
}
