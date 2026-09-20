'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const changeUrl = (b: string, h: string, plan?: string | null) =>
  `/review?base=${encodeURIComponent(b)}&head=${encodeURIComponent(h)}${plan ? `&plan=${encodeURIComponent(plan)}` : ''}`;

/**
 * Which change the URL names: `/review` is the list, `/review?base=main&head=feat` is one change, and an
 * optional `&plan=<id>` compares it with a saved plan (#316). The plan is only an id; the server checks it.
 */
export function useReviewRoute() {
  const params = useSearchParams();
  const router = useRouter();
  const base = params.get('base');
  const head = params.get('head');
  const plan = params.get('plan');
  const openChange = useCallback((b: string, h: string, p?: string | null) => router.push(changeUrl(b, h, p)), [router]);
  /** Switch the plan on the change being viewed (or clear it with null); replaces the URL, no new history entry. */
  const setPlan = useCallback((b: string, h: string, p: string | null) => router.replace(changeUrl(b, h, p)), [router]);
  const openList = useCallback((b?: string | null) => router.push(b ? `/review?base=${encodeURIComponent(b)}` : '/review'), [router]);
  return { base, head, plan, openChange, setPlan, openList };
}
