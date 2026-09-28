'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { previewFrameStyle, previewSizeReadout } from '../domain/PreviewFrameStyle';
import { resolvePreviewSelection } from '../domain/PreviewSelection';
import { isLocalPreviewUrl, normalizePreviewUrl } from '../domain/PreviewUrl';
import { openSourceTargetFromCxSrc } from '../domain/OpenSource';
import { createIframePreviewSource } from '../services/PreviewSource';
import { createFiberPreviewSource } from '../services/PreviewFiberSource';
import { resolveFiberSourceSelection } from '../services/PreviewFiberApi';
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reach, setReach] = useState<PreviewReach>('unknown');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef({ roots, feature, file, onSelectNode });
  latest.current = { roots, feature, file, onSelectNode };
  const sizing = usePreviewSize();
  const full = useFullScreenPreview(Boolean(url));

  const source = useMemo(() => (url ? createIframePreviewSource(url, () => frameRef.current?.contentWindow) : null), [url]);
  const signals = usePreviewSignals(source, reach === 'up');

  // #443 live preview v2: reads React's own dev-time internals through the injecting proxy, so
  // click-to-source needs nothing installed in the target app. Only live once the frame is actually
  // showing the proxy's address (never the dev server's own address) with its per-session nonce.
  const fiberSource = useMemo(
    () => (previewUrl && previewNonce && url === previewUrl ? createFiberPreviewSource(previewUrl, previewNonce, () => frameRef.current?.contentWindow) : null),
    [previewUrl, previewNonce, url],
  );

  useEffect(() => {
    if (!fiberSource) { setPickMode(false); return undefined; }
    return () => fiberSource.detach();
  }, [fiberSource]);

  useEffect(() => {
    fiberSource?.setPick(pickMode);
  }, [fiberSource, pickMode]);

  useEffect(() => {
    if (!fiberSource) return undefined;
    return fiberSource.onSelect((selection) => {
      resolveFiberSourceSelection(selection).then(({ status, resolution }) => {
        const cur = latest.current;
        if (status === 409) { setMessage('The dev server stopped before this selection resolved.'); return; }
        if (!resolution?.ok || resolution.file == null || resolution.line == null || resolution.column == null) {
          setMessage(resolution?.componentName ? `Could not resolve ${resolution.componentName} to a source location.` : 'Could not resolve that element to a source location.');
          return;
        }
        const r = resolvePreviewSelection(`${resolution.file}:${resolution.line}:${resolution.column}`, cur.roots, cur.feature, cur.file);
        if (r.kind === 'selected') {
          cur.onSelectNode(r.nodeId);
          setMessage(`Selected ${resolution.componentName ?? resolution.file}`);
        } else if (r.kind === 'other-file') {
          setMessage(`That element lives in ${r.file}, not the open page.`);
        } else if (r.kind === 'stale') {
          setMessage('No element at that position in the open page — reload the preview if you just edited it.');
        } else {
          setMessage('Unrecognised source annotation from the preview.');
        }
      });
    });
  }, [fiberSource]);

  useEffect(() => {
    if (!fiberSource) return undefined;
    return fiberSource.onError(({ reason }) => setMessage(`Live preview could not read that element (${reason}).`));
  }, [fiberSource]);

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
    setPreviewUrl(null);
    setPreviewNonce(null);
    probe(normalized);
  }, [draft, probe]);

  /** Point the frame at an address the Cockpit itself was given (the dev server it started, #378), or, when
   * one is up, at the injecting proxy's address with its nonce (#443) so click-to-source reads fiber data. */
  const connectTo = useCallback((target: string, previewTarget?: string | null, nonce?: string | null) => {
    const normalized = normalizePreviewUrl(target);
    if (!normalized) return;
    setDraft(normalized);
    setMessage(null);
    setUrl(normalized);
    setPreviewUrl(previewTarget ?? null);
    setPreviewNonce(nonce ?? null);
    probe(normalized);
  }, [probe]);

  const disconnect = useCallback(() => {
    setUrl(null);
    setPreviewUrl(null);
    setPreviewNonce(null);
    setMessage(null);
    setReach('unknown');
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

  const onTogglePick = useCallback(() => setPickMode((p) => !p), []);

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
      pickAvailable: Boolean(fiberSource),
      pickMode,
      onTogglePick,
    }),
    [draft, url, message, connect, disconnect, reach, retry, sizing, full, signals.plugin, signals.appError, signals.appErrorSrc, signals.dismissAppError, showInSource, fiberSource, pickMode, onTogglePick],
  );

  return { draft, setDraft, url, message, frameRef, connect, connectTo, release, disconnect, fullScreen: full.fullScreen, view };
}
