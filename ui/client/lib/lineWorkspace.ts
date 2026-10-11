'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LineWorkspace } from './lineContract';
import { lineHttp } from './lineHttp';

// cu6: the open project's Line workspace folder, shared by the shell's project switcher (which shows and changes it)
// and every Line screen (which tags items outside it "Read-only"). The server is the source of truth
// (GET/POST /api/line/workspace); the writer refuses changes outside the folder whatever the screens show.

export { isInWorkspace, workspaceLabel } from './lineWorkspacePaths';

export type LineWorkspaceState = {
  /** null until read, or when there is no open project. */
  folder: string | null;
  error: string | null;
  /** Store a new folder; resolves to the refusal sentence, or null when it was saved. */
  change: (folder: string) => Promise<string | null>;
};

/** The open project's workspace folder, read once on mount. */
export function useLineWorkspace(): LineWorkspaceState {
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    lineHttp.getWorkspace().then(
      (w) => { if (live && 'folder' in w) setFolder(w.folder); },
      () => undefined,
    );
    return () => { live = false; };
  }, []);
  const change = useCallback(async (next: string) => {
    let body: LineWorkspace | { sentence?: string };
    try {
      body = await lineHttp.setWorkspace({ folder: next });
    } catch {
      body = { sentence: 'The Cockpit server did not answer; the workspace folder was not changed.' };
    }
    if ('folder' in body) {
      setFolder(body.folder);
      setError(null);
      return null;
    }
    const sentence = body.sentence ?? 'The workspace folder could not be changed.';
    setError(sentence);
    return sentence;
  }, []);
  return { folder, error, change };
}
