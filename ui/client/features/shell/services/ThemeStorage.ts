import { parseThemePreference, resolveTheme } from '../domain/Theme.ts';
import { THEME_STORAGE_KEY } from '../domain/ThemeInit.ts';
import type { Theme, ThemePreference } from '../types.ts';

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

/** Whether the operating system asks for a light interface right now. */
export function systemPrefersLight(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

/** The theme a preference paints today. */
export function resolvePreference(preference: ThemePreference): Theme {
  return resolveTheme(preference, systemPrefersLight());
}

/** Applies the theme to <html data-theme>. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}
