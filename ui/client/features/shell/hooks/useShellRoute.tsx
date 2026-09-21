'use client';

import { usePathname } from 'next/navigation';
import { primaryScreenForPath } from '../domain/PrimaryScreens';

/** Current path and which top-bar screen it belongs to. */
export function useShellRoute() {
  const pathname = usePathname() ?? '/';
  return { pathname, screen: primaryScreenForPath(pathname) };
}
