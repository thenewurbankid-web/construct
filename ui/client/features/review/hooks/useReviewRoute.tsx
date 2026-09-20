'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Which change the URL names: `/review` is the list, `/review?base=main&head=feat` is one change. */
export function useReviewRoute() {
  const params = useSearchParams();
  const router = useRouter();
  const base = params.get('base');
  const head = params.get('head');
  const openChange = useCallback((b: string, h: string) => router.push(`/review?base=${encodeURIComponent(b)}&head=${encodeURIComponent(h)}`), [router]);
  const openList = useCallback((b?: string | null) => router.push(b ? `/review?base=${encodeURIComponent(b)}` : '/review'), [router]);
  return { base, head, openChange, openList };
}
