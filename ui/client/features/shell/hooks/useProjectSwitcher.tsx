'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchProjectDir, switchProjectDir } from '../services/ProjectApi';
import { projectLabel } from '../domain/ProjectLabel';

/** Current local project + the switch action (reuses the settings project dir).
 * After a successful switch the page reloads so every screen re-reads the new
 * project (each screen fetches its data on mount). */
export function useProjectSwitcher() {
  const [dir, setDir] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjectDir().then((d) => {
      setDir(d);
      setKnown(true);
    });
  }, []);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const choose = useCallback(async (next: string) => {
    const err = await switchProjectDir(next);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setDir(next);
    setOpen(false);
    window.location.reload();
  }, []);

  return { dir, known, label: projectLabel(dir), open, toggle, show, close, choose, error };
}
