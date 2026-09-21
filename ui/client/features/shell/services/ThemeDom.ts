import { resolveTheme } from '../domain/ThemePreference.ts';
import type { Theme, ThemePreference } from '../types.ts';

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
