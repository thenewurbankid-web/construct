// The preview transport behind a small interface, so the iframe + postMessage
// implementation can be swapped (e.g. a devtools-protocol or websocket source)
// without touching the hook/component layers.
/** What the previewed app tells the Cockpit besides a selection (#378): the preview plugin is loaded (`ready`),
 * or the app threw an uncaught error (`error`). `src` (#558) is the stack's top project frame as a
 * `data-cx-src`-shaped "file:line:col" string, or null when the stack has no project frame (a library-only
 * stack shows no "Show in source" button). Nothing else crosses. */
export type PreviewSignal = { type: 'ready' } | { type: 'error'; message: string; src: string | null };

/** #835 -- one element's bounding box, in the iframe's own viewport coordinates (the caller offsets by the
 * frame's position on the page). */
export type PreviewRect = { top: number; left: number; width: number; height: number };
/** A request for the rect of the element nearest `file:line` (the bridge matches by line distance within
 * the file, not an exact column -- see `previewBridge.mjs`'s `elementAt`). `key` is the caller's own id,
 * echoed back; this bridge knows nothing about the Cockpit's tree or node ids. */
export type PreviewRectQuery = { key: string; file: string; line: number };

export interface PreviewSource {
  /** Page being previewed. */
  readonly url: string;
  /** Subscribe to element selections (a raw `data-cx-src` value). Returns an unsubscribe. */
  onSelect(handler: (src: string) => void): () => void;
  /** Subscribe to the plugin's `ready` and the app's `error` messages. Returns an unsubscribe. */
  onSignal(handler: (signal: PreviewSignal) => void): () => void;
  /** #375 -- tell the bridge whether Pick is on: off by default, an un-modified click reaches the
   * app untouched (Alt+Click always selects regardless, handled entirely on the bridge's side). */
  setPicking(on: boolean): void;
  /** #835 -- ask the bridge for the rects of a batch of nodes; resolves with one entry per query `key`,
   * `null` for a query with nothing currently rendered. Resolves to `{}` if the bridge never answers
   * (not installed, or the frame navigated away) rather than hanging forever. */
  requestRects(queries: PreviewRectQuery[]): Promise<Record<string, PreviewRect | null>>;
}

/** iframe transport: accepts `construct:*` messages only from the given
 * iframe's window AND only from the previewed URL's origin. */
export function createIframePreviewSource(url: string, getFrameWindow: () => Window | null | undefined): PreviewSource {
  const origin = new URL(url).origin;
  /** Subscribe to the frame's messages; `pick` turns one into a value, or `null` to ignore it. */
  const subscribe = <T,>(pick: (d: { type?: unknown; src?: unknown; message?: unknown }) => T | null, handler: (v: T) => void) => {
    const listener = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      const frame = getFrameWindow();
      if (!frame || e.source !== frame) return;
      const d = e.data as { type?: unknown; src?: unknown; message?: unknown } | null;
      const v = d ? pick(d) : null;
      if (v !== null) handler(v);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  };
  let nextRectsRequestId = 1;
  const pendingRects = new Map<number, (rects: Record<string, PreviewRect | null>) => void>();
  window.addEventListener('message', (e) => {
    if (e.origin !== origin) return;
    const frame = getFrameWindow();
    if (!frame || e.source !== frame) return;
    const d = e.data as { type?: unknown; requestId?: unknown; rects?: Record<string, PreviewRect | null> } | null;
    if (d && d.type === 'construct:rects' && typeof d.requestId === 'number') {
      const resolve = pendingRects.get(d.requestId);
      if (resolve) {
        pendingRects.delete(d.requestId);
        resolve(d.rects ?? {});
      }
    }
  });
  return {
    url,
    onSelect: (handler) => subscribe((d) => (d.type === 'construct:select' && typeof d.src === 'string' ? d.src : null), handler),
    onSignal: (handler) => subscribe<PreviewSignal>((d) => {
      if (d.type === 'construct:ready') return { type: 'ready' };
      if (d.type === 'construct:error') {
        return {
          type: 'error',
          message: typeof d.message === 'string' ? d.message.slice(0, 300) : 'Unknown error',
          src: typeof d.src === 'string' ? d.src : null,
        };
      }
      return null;
    }, handler),
    setPicking: (on) => getFrameWindow()?.postMessage({ type: 'construct:pick', on }, origin),
    requestRects: (queries) => new Promise((resolve) => {
      const requestId = nextRectsRequestId++;
      pendingRects.set(requestId, resolve);
      getFrameWindow()?.postMessage({ type: 'construct:rects-request', requestId, queries }, origin);
      setTimeout(() => {
        if (pendingRects.delete(requestId)) resolve({});
      }, 1000);
    }),
  };
}
