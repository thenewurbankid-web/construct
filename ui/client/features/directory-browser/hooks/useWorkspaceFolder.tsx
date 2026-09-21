'use client';

import { useEffect, useState } from 'react';
import { browseDirectory } from '../services/DirectoryBrowser';

export type WorkspaceFolder = { state: 'loading' } | { state: 'found'; path: string } | { state: 'missing' };

/** Looks for a folder named `name` directly inside the workspace, using the same workspace-scoped listing the
 * folder picker uses (no other access). `missing` also covers a failed listing: callers only offer a shortcut
 * when the folder is really there. */
export function useWorkspaceFolder(name: string): WorkspaceFolder {
  const [result, setResult] = useState<WorkspaceFolder>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    // The first page is enough for a shortcut; a huge workspace simply may not offer one.
    browseDirectory({}).then((listing) => {
      if (!alive) return;
      const hit = listing.ok ? listing.entries.find((e) => e.name === name) : undefined;
      setResult(hit ? { state: 'found', path: hit.path } : { state: 'missing' });
    });
    return () => {
      alive = false;
    };
  }, [name]);
  return result;
}
