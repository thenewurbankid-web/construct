'use client';

import { useCallback, useEffect, useState } from 'react';
import { parseTheme, toggleTheme } from '../domain/Theme';
import { applyTheme, loadTheme, saveTheme } from '../services/ThemeStorage';
import type { Theme } from '../types';

/** Current theme + toggle. The initial value is 'dark' for SSR/hydration
 * parity; the real stored value is read right after mount (the inline init
 * script in the document head has already applied it, so there is no flash).
 * <html data-theme> is the source of truth, so several callers (the top-bar
 * switch and the command palette) stay in sync: each observes the attribute. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(loadTheme());
    const observer = new MutationObserver(() => setTheme(parseTheme(document.documentElement.getAttribute('data-theme'))));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    const next = toggleTheme(parseTheme(document.documentElement.getAttribute('data-theme')));
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  }, []);

  return { theme, toggle };
}
