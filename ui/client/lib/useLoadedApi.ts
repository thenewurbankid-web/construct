'use client';

import { useEffect, useState } from 'react';

/** A screen's API, loaded once (the server's, or the contract mock in Line mock mode); `given` (tests) is used as is. */
export function useLoadedApi<T>(load: () => Promise<T>, given?: T): T | null {
  const [api, setApi] = useState<T | null>(given ?? null);
  useEffect(() => {
    if (given) return;
    let live = true;
    load().then((a) => { if (live) setApi(() => a); });
    return () => { live = false; };
  }, [given, load]);
  return api;
}
