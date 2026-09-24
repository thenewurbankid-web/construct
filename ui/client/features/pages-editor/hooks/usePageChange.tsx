'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PageChange } from '../types';
import { dismissPageChange, getPageChange } from '../services/PageChangesApi';
import { watchPageChange } from '../services/PageChangePolling';

/** Polls the server for the open file's last external change (#224). */
export function usePageChange(feature: string, file: string, active: boolean, reopen: () => void) {
  const [change, setChange] = useState<PageChange | null>(null);

  useEffect(() => {
    setChange(null);
    if (!active || !feature || !file) return;
    return watchPageChange(() => getPageChange(feature, file), setChange);
  }, [feature, file, active]);

  const dismiss = useCallback(() => {
    setChange(null);
    dismissPageChange(feature, file).catch(() => {});
  }, [feature, file]);

  /** Re-open the file from disk and clear the notice. */
  const reload = useCallback(() => { dismiss(); reopen(); }, [dismiss, reopen]);

  return { change, dismiss, reload };
}
