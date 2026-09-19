import { parseTheme } from '../domain/Theme.ts';
import { THEME_STORAGE_KEY } from '../domain/ThemeInit.ts';
import type { Theme } from '../types.ts';

/** Reads the persisted theme; every browser-storage access is guarded
 * (private windows / blocked site data throw). */
export function loadTheme(): Theme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return parseTheme(null);
  }
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* persistence is a convenience, not required */
  }
}

/** Applies the theme to <html data-theme>. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}
