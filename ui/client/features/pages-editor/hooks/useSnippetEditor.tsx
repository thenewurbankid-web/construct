'use client';

import { useEffect, useState } from 'react';
import { getNodeSnippet, saveNodeSnippet } from '../services/PagesEditor';
import type { PageTree, StatusMessage } from '../types';

/** Isolated snippet edit + save-back-to-source for one node (#52). Called
 * directly from the SnippetEditor component — a component may import a
 * hook (only controllers/workflows/services/domain imports are banned in
 * component files), so the real fetch/save I/O still lives behind the
 * service layer rather than in the component itself. */
export function useSnippetEditor(feature: string, file: string, nodeId: string, contentHash: string, onSaved: (tree: PageTree) => void) {
  const [snippet, setSnippet] = useState('');
  const [loadedHash, setLoadedHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  useEffect(() => {
    setStatus(null);
    getNodeSnippet(feature, file, nodeId).then((r) => {
      setSnippet(r.snippet || '');
      setLoadedHash(r.contentHash);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, file, nodeId, contentHash]);

  async function save() {
    setBusy(true);
    setStatus(null);
    const result = await saveNodeSnippet({ feature, file, nodeId, snippet, contentHash: loadedHash || '' });
    setBusy(false);
    if (result.ok) {
      setStatus({ ok: true, message: 'Saved — patched back into the source file.' });
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error || 'Save failed.', violations: result.violations });
    }
  }

  return { snippet, setSnippet, busy, status, save };
}
