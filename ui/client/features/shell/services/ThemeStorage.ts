import { parseThemePreference } from '../domain/ThemePreference.ts';
import { THEME_STORAGE_KEY } from '../domain/ThemeInit.ts';
import type { ThemePreference } from '../types.ts';

/** Reads the persisted preference (dark, light or system); every browser-storage access is guarded
 * (private windows / blocked site data throw). */
export function loadThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return parseThemePreference(null);
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* persistence is a convenience, not required */
  }
}
