'use client';

import { useCallback, useEffect, useState } from 'react';
import { closeProjectDir, fetchProjectDir, switchProjectDir } from '../services/ProjectApi';
import { projectLabel } from '../domain/ProjectLabel';

/** Current local project + the switch and close actions (reuses the settings project dir).
 * After a successful switch or close the page reloads so every screen re-reads the project
 * (each screen fetches its data on mount). Closing (#365) leaves the server with none open. */
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

  const finish = useCallback((err: string | null, next: string | null) => {
    setError(err);
    if (err) return;
    setDir(next);
    setOpen(false);
    window.location.reload();
  }, []);
  const choose = useCallback(async (next: string) => finish(await switchProjectDir(next), next), [finish]);
  const closeProject = useCallback(async () => finish(await closeProjectDir(), null), [finish]);

  return { dir, known, label: projectLabel(dir), open, toggle, show, close, choose, closeProject, error };
}
