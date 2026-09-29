'use client';

import { useEffect, useState } from 'react';
import { fetchFlowCatalogue } from '../services/EnvelopesApi';
import type { FlowCatalogueEntry } from '../types';

/** The real plan-flow catalogue the compose step picker offers, read once when the tab opens. */
export function useFlowCatalogue(): { rows: FlowCatalogueEntry[]; error: string | null } {
  const [rows, setRows] = useState<FlowCatalogueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFlowCatalogue().then((r) => {
      if (cancelled) return;
      if (r.ok) setRows(r.rows);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { rows, error };
}
