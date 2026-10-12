import { useCallback, useState } from 'react';
import { fetchProjectTree } from '../services/ProjectTree';
import type { ProjectTree } from '../types';

/** The picker's state: closed, or open on one directory of the project. */
export function useProjectTree() {
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<ProjectTree | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError('');
    const result = await fetchProjectTree(path);
    if (result.ok) setTree(result);
    else setError(result.error);
    setLoading(false);
  }, []);

  const openPicker = useCallback(() => {
    setOpen(true);
    void load('');
  }, [load]);

  return { open, tree, error, loading, load, openPicker, closePicker: () => setOpen(false) };
}
