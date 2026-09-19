'use client';

import { usePathname } from 'next/navigation';
import { modeForPath } from '../domain/Modes';

/** Current path and which top-bar mode it belongs to. */
export function useShellRoute() {
  const pathname = usePathname() ?? '/';
  return { pathname, mode: modeForPath(pathname) };
}
