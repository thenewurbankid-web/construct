'use client';

import { useEffect, useState } from 'react';
import type { PaletteData } from '../types';
import { getPalette } from '../services/PaletteApi';

/** The open page's feature's Palette (#527): refetches only when the feature itself changes, not on
 * every node/file selection -- Providers/Expressions/Components are the same for every page of a
 * feature (see block-palette.md section 2). */
export function usePalette(feature: string) {
  const [data, setData] = useState<PaletteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
  }, [feature]);

  return { data, error, loading };
}
