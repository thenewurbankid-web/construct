// Pure (DOMAIN-001): the Dark / Light / System preference chosen in the profile menu (#368). No storage, no DOM.
import type { Theme, ThemePreference } from '../types.ts';
import { parseTheme } from './Theme.ts';

/** What the person chose: a fixed theme, or "follow the operating system". Unknown means dark (the default). */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'system' ? 'system' : parseTheme(value);
}

/** The theme actually painted for a preference; `systemPrefersLight` is the OS setting, read by the caller. */
export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): Theme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}
