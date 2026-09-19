'use client';

import { useTheme } from '../hooks/useTheme';
import { ThemeToggle } from '../components/ThemeToggle';

/** Mount anywhere a theme switch is needed (the top bar). */
export function ThemeController() {
  const { theme, toggle } = useTheme();
  return <ThemeToggle theme={theme} onToggle={toggle} />;
}
