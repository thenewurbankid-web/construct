'use client';

import { useCallback, useEffect, useState } from 'react';
import { readSelection, withSelection } from '../domain/QuerySelection';

/** A selection that lives in the URL query (`?feature=billing`): read once after mount (so server and first client
 * paint agree), written with `history.replaceState` (no new history entry, no navigation, no re-render of the route).
 * `ready` is false until the URL has been read, so a screen does not flash "nothing selected" before restoring it. */
export function useUrlSelection(param: string) {
  const [value, setValue] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setValue(readSelection(window.location.search, param));
    setReady(true);
  }, [param]);
  const select = useCallback(
    (next: string | null) => {
      setValue(next);
      const search = withSelection(window.location.search, param, next);
      window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
    },
    [param],
  );
  return { value, select, ready };
}
