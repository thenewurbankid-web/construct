'use client';

import { useCallback, useEffect, useState } from 'react';
import { toggleTheme } from '../domain/Theme';
import { applyTheme, loadTheme, saveTheme } from '../services/ThemeStorage';
import type { Theme } from '../types';

/** Current theme + toggle. The initial value is 'dark' for SSR/hydration
 * parity; the real stored value is read right after mount (the inline init
 * script in the document head has already applied it, so there is no flash). */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(loadTheme());
  }, []);

  const toggle = useCallback(() => {
    const next = toggleTheme(theme);
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
}
