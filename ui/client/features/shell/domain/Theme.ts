// Pure (DOMAIN-001): theme parsing and toggling. No storage, no DOM.
import type { Theme } from '../types.ts';

export const DEFAULT_THEME: Theme = 'dark';

/** Anything that is not exactly a known theme falls back to the default. */
export function parseTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME;
}

export function toggleTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
