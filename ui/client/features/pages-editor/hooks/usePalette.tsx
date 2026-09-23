'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PaletteData } from '../types';
import { getPalette } from '../services/PaletteApi';

/** The open page's feature's Palette (#527): refetches only when the feature itself changes, not on
 * every node/file selection -- Providers/Expressions/Components are the same for every page of a
 * feature (see block-palette.md section 2). `refetch` (#533) lets a caller ask for a fresh read
 * after something OTHER than a feature change adds a unit the list should now show -- a confirmed
 * "Wrap with..." creates a brand-new Expression this same list needs to include next render. */
export function usePalette(feature: string) {
  const [data, setData] = useState<PaletteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!feature) {
      setData(null);
      return;
    }
    setLoading(true);
    getPalette(feature)
      .then((r) => {
        if (cancelled) return;
        if (r.error) {
          setData(null);
          setError(r.error);
        } else {
          setData(r);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feature, reloadToken]);

  return { data, error, loading, refetch };
}
