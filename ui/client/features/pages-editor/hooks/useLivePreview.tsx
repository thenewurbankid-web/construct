'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolvePreviewSelection } from '../domain/PreviewSelection';
import { normalizePreviewUrl } from '../domain/PreviewUrl';
import { createIframePreviewSource } from '../services/PreviewSource';
import type { PagesEditorNode } from '../types';

type Args = {
  roots: PagesEditorNode[];
  feature: string;
  file: string;
  onSelectNode: (id: string) => void;
};

/** Live preview state: a user-provided URL (input draft + the URL actually
 * framed), and click-to-source — a selection posted by the framed app is
 * resolved against the open page's tree and selects the matching node. */
export function useLivePreview({ roots, feature, file, onSelectNode }: Args) {
  const [draft, setDraft] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef({ roots, feature, file, onSelectNode });
  latest.current = { roots, feature, file, onSelectNode };

  const source = useMemo(() => (url ? createIframePreviewSource(url, () => frameRef.current?.contentWindow) : null), [url]);

  useEffect(() => {
    if (!source) return undefined;
    return source.onSelect((src) => {
      const cur = latest.current;
      const r = resolvePreviewSelection(src, cur.roots, cur.feature, cur.file);
      if (r.kind === 'selected') {
        cur.onSelectNode(r.nodeId);
        setMessage(`Selected ${src}`);
      } else if (r.kind === 'other-file') {
        setMessage(`That element lives in ${r.file}, not the open page.`);
      } else if (r.kind === 'stale') {
        setMessage('No element at that position in the open page — reload the preview if you just edited it.');
      } else {
        setMessage('Unrecognised source annotation from the preview.');
      }
    });
  }, [source]);

  function connect() {
    const normalized = normalizePreviewUrl(draft);
    if (!normalized) {
      setMessage('Enter a full http(s) URL, e.g. http://localhost:5173');
      return;
    }
    setMessage(null);
    setUrl(normalized);
  }

  function disconnect() {
    setUrl(null);
    setMessage(null);
  }

  return { draft, setDraft, url, message, frameRef, connect, disconnect };
}
