'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { openPageQuery, requestOpenPage, type OpenPageTarget } from '@/features/pages-editor';

/** Navigation actions the shell offers its slots: go to a route, or open a
 * page file in the Pages editor (in place when it is already showing). */
export function useShellNavigation(pathname: string) {
  const router = useRouter();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const openPage = useCallback(
    (target: OpenPageTarget) => {
      if (pathname === '/pages') requestOpenPage(target);
      else router.push(`/pages${openPageQuery(target)}`);
    },
    [pathname, router],
  );
  return { navigate, openPage };
}
