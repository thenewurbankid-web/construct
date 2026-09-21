'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { previewFrameStyle, previewSizeReadout } from '../domain/PreviewFrameStyle';
import { resolvePreviewSelection } from '../domain/PreviewSelection';
import { normalizePreviewUrl } from '../domain/PreviewUrl';
import { createIframePreviewSource } from '../services/PreviewSource';
import { probePreview } from '../services/PreviewReachability';
import type { LivePreviewView, PreviewReach } from '../domain/LivePreviewView';
import type { PagesEditorNode } from '../types';
import { useFullScreenPreview } from './useFullScreenPreview';
import { usePreviewSize } from './usePreviewSize';

type Args = {
  roots: PagesEditorNode[];
  feature: string;
  file: string;
  onSelectNode: (id: string) => void;
};

/** Live preview state: a user-provided URL (input draft + the URL actually
 * framed), click-to-source — a selection posted by the framed app is resolved
 * against the open page's tree and selects the matching node — and, since #456,
 * how big the frame is (device sizes, remembered per project), whether the dev
 * server is actually answering, and full screen.
 *
 * The URL is set once and left alone: choosing a size or going full screen only
 * changes the box around the iframe, never its `src`, so the app under
 * development keeps its own state and the selected node survives. */
export function useLivePreview({ roots, feature, file, onSelectNode }: Args) {
  const [draft, setDraft] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reach, setReach] = useState<PreviewReach>('unknown');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef({ roots, feature, file, onSelectNode });
  latest.current = { roots, feature, file, onSelectNode };
  const sizing = usePreviewSize();
  const full = useFullScreenPreview(Boolean(url));

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

  const probe = useCallback((target: string) => {
    setReach('checking');
    probePreview(target).then((up) => setReach(up ? 'up' : 'down'));
  }, []);

  const connect = useCallback(() => {
    const normalized = normalizePreviewUrl(draft);
    if (!normalized) {
      setMessage('Enter a full http(s) URL, e.g. http://localhost:5173');
      return;
    }
    setMessage(null);
    setUrl(normalized);
    probe(normalized);
  }, [draft, probe]);

  const disconnect = useCallback(() => {
    setUrl(null);
    setMessage(null);
    setReach('unknown');
    full.exit();
  }, [full]);

  const retry = useCallback(() => {
    if (url) probe(url);
  }, [url, probe]);

  const view = useMemo<LivePreviewView>(
    () => ({
      draft,
      onDraftChange: setDraft,
      url,
      message,
      frameRef,
      onConnect: connect,
      onDisconnect: disconnect,
      reach,
      onRetry: retry,
      onLoadAnyway: () => setReach('up'),
      size: sizing.size,
      sizes: sizing.sizes,
      onSize: sizing.choose,
      frameStyle: previewFrameStyle(sizing.option),
      sizeReadout: previewSizeReadout(sizing.measured),
      boxRef: sizing.boxRef,
      fullScreen: full.fullScreen,
      onFullScreen: full.open,
      onExitFullScreen: full.exit,
      fullScreenRef: full.triggerRef,
    }),
    [draft, url, message, connect, disconnect, reach, retry, sizing, full],
  );

  return { draft, setDraft, url, message, frameRef, connect, disconnect, fullScreen: full.fullScreen, view };
}
