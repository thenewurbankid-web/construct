'use client';

import { useCallback, useEffect, useState } from 'react';
import { parseTheme, toggleTheme } from '../domain/Theme';
import { loadThemePreference, saveThemePreference } from '../services/ThemeStorage';
import { applyTheme, resolvePreference } from '../services/ThemeDom';
import type { Theme, ThemePreference } from '../types';

/** Current theme, the person's preference (Dark / Light / System) and the actions to change it. The initial
 * values are 'dark' for SSR/hydration parity; the stored preference is read right after mount (the inline
 * init script in the document head has already applied it, so there is no flash). <html data-theme> is the
 * resolved source of truth. While the preference is "system", a change of the operating system's own
 * setting is followed live. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [preference, setPreferenceState] = useState<ThemePreference>('dark');

  useEffect(() => {
    setPreferenceState(loadThemePreference());
    setTheme(parseTheme(document.documentElement.getAttribute('data-theme')));
    const observer = new MutationObserver(() => setTheme(parseTheme(document.documentElement.getAttribute('data-theme'))));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    applyTheme(resolvePreference(next));
    saveThemePreference(next);
    setPreferenceState(next);
  }, []);

  useEffect(() => {
    if (preference !== 'system') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const follow = () => applyTheme(resolvePreference('system'));
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [preference]);

  /** The palette's "Toggle dark / light theme": flips what is painted and pins it as an explicit choice. */
  const toggle = useCallback(() => {
    setPreference(toggleTheme(parseTheme(document.documentElement.getAttribute('data-theme'))));
  }, [setPreference]);

  return { theme, preference, setPreference, toggle };
}
