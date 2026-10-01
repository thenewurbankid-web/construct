'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { previewFrameStyle, previewSizeReadout } from '../domain/PreviewFrameStyle';
import { isLocalPreviewUrl, normalizePreviewUrl } from '../domain/PreviewUrl';
import { createIframePreviewSource } from '../services/PreviewSource';
import { probePreview } from '../services/PreviewReachability';
import type { LivePreviewView, PreviewReach } from '../domain/LivePreviewView';
import { useFullScreenPreview } from './useFullScreenPreview';
import { usePreviewSignals } from './usePreviewSignals';
import { usePreviewSize } from './usePreviewSize';

export type PreviewArgs = {
  /** A raw `data-cx-src` value ("file:line:col") the framed app posted on click: resolve what it means for the
   * screen hosting this preview (e.g. select a tree node) and return the status message to show, or `null` for
   * none. Omitted on a screen with nothing to select against -- the message then just echoes the raw value. */
  onSourceSelected?: (src: string) => string | null;
  /** "Show in source" after an app error (#558) -- a screen with nowhere to open a file simply omits this. */
  onShowInSource?: (src: string) => void;
};

/** #834/#837 -- live preview state, shared by any screen that frames a dev server (pages-editor was the first
 * and only consumer; this is the extraction so Features/Tests/Git can embed the same thing instead of a second
 * copy): a user-provided URL (input draft + the URL actually framed), click-to-source (a selection posted by
 * the framed app, resolved by the CALLER -- this hook knows nothing about trees or nodes), how big the frame is
 * (device sizes, remembered per project), whether the dev server is actually answering, and full screen.
 *
 * The URL is set once and left alone: choosing a size or going full screen only changes the box around the
 * iframe, never its `src`, so the app under development keeps its own state and the selection survives. */
export function usePreview({ onSourceSelected, onShowInSource }: PreviewArgs = {}) {
  const [draft, setDraft] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reach, setReach] = useState<PreviewReach>('unknown');
  // #375 -- Pick: off by default (a normal, clickable app); an un-modified click in the frame
  // only selects while this is on (Alt+Click always works, handled entirely by the bridge).
  const [picking, setPicking] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef({ onSourceSelected, onShowInSource });
  latest.current = { onSourceSelected, onShowInSource };
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
      const handle = latest.current.onSourceSelected;
      setMessage(handle ? handle(src) : `Selected ${src}`);
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

  const showInSource = useCallback((src: string) => {
    latest.current.onShowInSource?.(src);
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
