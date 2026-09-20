'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchProjectKey } from '../services/FlowApi';
import { loadBrowserView, saveBrowserView } from '../services/BrowserViewStorage';
import type { BrowserView } from '../types';

/** The Browser pane's Files | Flow choice, remembered per project. Files until the project is known and
 * whenever nothing was chosen before, so the pane never opens on a view nobody asked for. */
export function useBrowserView() {
  const [view, setView] = useState<BrowserView>('files');
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [known, setKnown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchProjectKey().then((key) => {
      if (cancelled) return;
      setProjectKey(key);
      setView(loadBrowserView(key));
      setKnown(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback(
    (next: BrowserView) => {
      setView(next);
      if (known) saveBrowserView(projectKey, next);
    },
    [known, projectKey],
  );

  return { view, choose };
}
