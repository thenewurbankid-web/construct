'use client';

import { useCallback, useEffect, useState } from 'react';
import { confirmWrap, getWrapSuggestion } from '../services/PaletteApi';
import type { PageTree, StatusMessage, WrapSuggestion } from '../types';

/**
 * #533 (Slice 3 of #518's design) -- "Wrap with...": follows the current JSX selection (`nodeId`,
 * the same selection every other Pages editor tab already uses), asks the server what it suggests
 * (a flagged hit, fit-checked Expressions, a real dry-run preview once a name is available), and
 * turns "Approve" into the real, non-dry-run extraction. Two calls only, mirroring #527/#532's own
 * read/write split: GET wrap-suggest (never writes) and POST wrap (only reached from Approve).
 */
export function usePaletteWrap(feature: string, file: string, contentHash: string, selectedNodeId: string | null, onWrapped: (tree: PageTree) => void, onExpressionCreated: () => void) {
  const [suggestion, setSuggestion] = useState<WrapSuggestion | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  // A genuinely NEW selection (or a different file/feature) starts over: forget any preview/status
  // from a previous selection rather than showing it against the wrong JSX. Deliberately NOT keyed
  // on `contentHash`: a successful "Approve" itself changes the page's contentHash (the file it just
  // wrote), and re-running this on that self-inflicted change would wipe the very success status
  // "Approve" just set, a heartbeat after it appeared.
  useEffect(() => {
    let cancelled = false;
    setSuggestion(null);
    setStatus(null);
    setName('');
    if (!selectedNodeId) return;
    setLoading(true);
    getWrapSuggestion({ feature, file, nodeId: selectedNodeId })
      .then((r) => {
        if (cancelled) return;
        setSuggestion(r);
        if (r.name) setName(r.name);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feature, file, selectedNodeId]);

  /** "Wrap with..." — fetches the real dry-run preview for the current name (derived, or typed). */
  const preview = useCallback(async () => {
    if (!selectedNodeId || !name) return;
    setLoading(true);
    setStatus(null);
    const r = await getWrapSuggestion({ feature, file, nodeId: selectedNodeId, name, preview: true });
    setSuggestion(r);
    setLoading(false);
  }, [feature, file, selectedNodeId, name]);

  /** Cancel — drop the preview, keep the suggestion (hit/suggestions/name) so it can be edited again. */
  const cancelPreview = useCallback(() => {
    setSuggestion((s) => (s ? { ...s, files: null } : s));
  }, []);

  /** "Approve" — the only call in this whole flow that writes anything. */
  const confirm = useCallback(async () => {
    if (!selectedNodeId || !name) return;
    setConfirming(true);
    const result = await confirmWrap({ feature, file, nodeId: selectedNodeId, name, contentHash });
    setConfirming(false);
    if (result.ok) {
      setStatus({ ok: true, message: `Extracted ${result.expression?.name ?? name} → ${result.expression?.file ?? ''}.` });
      setSuggestion(null);
      onWrapped(result);
      onExpressionCreated();
    } else {
      setStatus({ ok: false, message: result.error || 'Could not wrap this selection.', violations: result.violations });
    }
  }, [feature, file, selectedNodeId, name, contentHash, onWrapped, onExpressionCreated]);

  return { suggestion, name, setName, loading, confirming, status, preview, cancelPreview, confirm };
}
