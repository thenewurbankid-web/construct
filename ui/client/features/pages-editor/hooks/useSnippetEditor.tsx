'use client';

import { useEffect, useMemo, useState } from 'react';
import { getNodeSnippet, saveNodeSnippet } from '../services/SnippetApi';
import { highlightJsxSnippet } from '../domain/SnippetHighlighting';
import { diffSnippetLines } from '../domain/SnippetDiff';
import type { PageTree, StatusMessage } from '../types';

/** Isolated snippet edit + save-back-to-source for one node (#52), extended
 * by #81 with JSX syntax highlighting and a diff preview shown before a
 * save is actually committed. Called directly from the SnippetEditor
 * component — a component may import a hook (only controllers/workflows/
 * services/domain imports are banned in component files), so the real
 * fetch/save I/O, highlighting, and diffing all stay behind this hook and
 * the layers it calls into rather than living in the component itself. */
export function useSnippetEditor(feature: string, file: string, nodeId: string, contentHash: string, onSaved: (tree: PageTree) => void) {
  const [snippet, setSnippet] = useState('');
  const [originalSnippet, setOriginalSnippet] = useState('');
  const [loadedHash, setLoadedHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    setStatus(null);
    setShowDiff(false);
    getNodeSnippet(feature, file, nodeId).then((r) => {
      setSnippet(r.snippet || '');
      setOriginalSnippet(r.snippet || '');
      setLoadedHash(r.contentHash);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, file, nodeId, contentHash]);

  const highlightedHtml = useMemo(() => highlightJsxSnippet(snippet), [snippet]);
  const diffHunks = useMemo(() => diffSnippetLines(originalSnippet, snippet), [originalSnippet, snippet]);
  const hasChanges = snippet !== originalSnippet;

  /** Opens the diff preview — nothing is saved yet. */
  function requestSave() {
    setStatus(null);
    setShowDiff(true);
  }

  function cancelSave() {
    setShowDiff(false);
  }

  /** The actual save-back-to-source call, only ever reached after the diff
   * preview has been shown and explicitly confirmed. */
  async function confirmSave() {
    setBusy(true);
    setStatus(null);
    const result = await saveNodeSnippet({ feature, file, nodeId, snippet, contentHash: loadedHash || '' });
    setBusy(false);
    setShowDiff(false);
    if (result.ok) {
      setStatus({ ok: true, message: 'Saved — patched back into the source file.' });
      setOriginalSnippet(snippet);
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error || 'Save failed.', violations: result.violations });
    }
  }

  return { snippet, setSnippet, busy, status, highlightedHtml, showDiff, diffHunks, hasChanges, requestSave, confirmSave, cancelSave };
}
