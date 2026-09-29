'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { previewFrameStyle, previewSizeReadout } from '../domain/PreviewFrameStyle';
import { resolvePreviewSelection } from '../domain/PreviewSelection';
import { isLocalPreviewUrl, normalizePreviewUrl } from '../domain/PreviewUrl';
import { openSourceTargetFromCxSrc } from '../domain/OpenSource';
import { createIframePreviewSource } from '../services/PreviewSource';
import { probePreview } from '../services/PreviewReachability';
import { requestOpenSource } from '../services/OpenSourceRequest';
import type { LivePreviewView, PreviewReach } from '../domain/LivePreviewView';
import type { PagesEditorNode } from '../types';
import { useFullScreenPreview } from './useFullScreenPreview';
import { usePreviewSignals } from './usePreviewSignals';
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
  // #375 -- Pick: off by default (a normal, clickable app); an un-modified click in the frame
  // only selects while this is on (Alt+Click always works, handled entirely by the bridge).
  const [picking, setPicking] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef({ roots, feature, file, onSelectNode });
  latest.current = { roots, feature, file, onSelectNode };
  const sizing = usePreviewSize();
  const full = useFullScreenPreview(Boolean(url));

  const source = useMemo(() => (url ? createIframePreviewSource(url, () => frameRef.current?.contentWindow) : null), [url]);
  const signals = usePreviewSignals(source, reach === 'up');

  // Re-sends on every `ready` too (a hot reload re-installs the bridge with picking reset to its
  // own default) so Pick stays in sync with the app instead of silently going stale.
  useEffect(() => {
    source?.setPicking(picking);
  }, [source, picking, signals.plugin]);

  const togglePick = useCallback(() => setPicking((p) => !p), []);

  useEffect(() => {
    if (!url) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url]);

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
    if (!isLocalPreviewUrl(normalized)) {
      setMessage('Only a local address can be previewed (localhost or 127.0.0.1): the preview shows your own dev server, not a site elsewhere.');
      return;
    }
    setMessage(null);
    setUrl(normalized);
    setPicking(false);
    probe(normalized);
  }, [draft, probe]);

  /** Point the frame at an address the Cockpit itself was given (the dev server it started, #378). */
  const connectTo = useCallback((target: string) => {
    const normalized = normalizePreviewUrl(target);
    if (!normalized) return;
    setDraft(normalized);
    setMessage(null);
    setUrl(normalized);
    setPicking(false);
    probe(normalized);
  }, [probe]);

  const disconnect = useCallback(() => {
    setUrl(null);
    setMessage(null);
    setReach('unknown');
    setPicking(false);
    full.exit();
  }, [full]);

  /** Let go of `target` only if that is what the frame is showing: a server stopping must not close a URL the person typed. */
  const release = useCallback((target: string) => {
    if (url && url === normalizePreviewUrl(target)) disconnect();
  }, [url, disconnect]);

  const retry = useCallback(() => {
    if (url) probe(url);
  }, [url, probe]);

  // #558: "Show in source" -- the src is already a data-cx-src-shaped "file:line:col" string (the
  // bridge's own stack resolution); parse it and ask the (separately mounted) Navigator to open it.
  const showInSource = useCallback((src: string) => {
    const target = openSourceTargetFromCxSrc(src);
    if (target) requestOpenSource(target);
  }, []);

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
      plugin: signals.plugin,
      appError: signals.appError,
      appErrorSrc: signals.appErrorSrc,
      onDismissAppError: signals.dismissAppError,
      onShowInSource: showInSource,
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
      picking,
      onTogglePick: togglePick,
    }),
    [draft, url, message, connect, disconnect, reach, retry, sizing, full, signals.plugin, signals.appError, signals.appErrorSrc, signals.dismissAppError, showInSource, picking, togglePick],
  );

  return { draft, setDraft, url, message, frameRef, connect, connectTo, release, disconnect, fullScreen: full.fullScreen, view };
}
