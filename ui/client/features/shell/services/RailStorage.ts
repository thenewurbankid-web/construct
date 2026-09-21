import { RAIL_STORAGE_KEY, parseRailCollapsed, serializeRailCollapsed } from '../domain/RailState.ts';

/** Reads the remembered rail preference; guarded (storage can throw or be blocked). */
export function loadRailCollapsed(): boolean {
  try {
    return parseRailCollapsed(window.localStorage.getItem(RAIL_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function saveRailCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, serializeRailCollapsed(collapsed));
  } catch {
    /* persistence is a convenience, not required */
  }
}
