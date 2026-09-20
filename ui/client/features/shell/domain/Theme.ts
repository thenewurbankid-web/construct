// Pure (DOMAIN-001): theme parsing, toggling and the Dark / Light / System preference. No storage, no DOM.
import type { Theme, ThemePreference } from '../types.ts';

export const DEFAULT_THEME: Theme = 'dark';

/** Anything that is not exactly a known theme falls back to the default. */
export function parseTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME;
}

export function toggleTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

/** What the person chose: a fixed theme, or "follow the operating system". Unknown means dark (the default). */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'system' ? 'system' : parseTheme(value);
}

/** The theme actually painted for a preference; `systemPrefersLight` is the OS setting, read by the caller. */
export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): Theme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}
