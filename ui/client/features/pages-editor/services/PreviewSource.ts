// The preview transport behind a small interface, so the iframe + postMessage
// implementation can be swapped (e.g. a devtools-protocol or websocket source)
// without touching the hook/component layers.
export interface PreviewSource {
  /** Page being previewed. */
  readonly url: string;
  /** Subscribe to element selections (a raw `data-cx-src` value). Returns an unsubscribe. */
  onSelect(handler: (src: string) => void): () => void;
}

/** iframe transport: accepts `construct:select` messages only from the given
 * iframe's window AND only from the previewed URL's origin. */
export function createIframePreviewSource(url: string, getFrameWindow: () => Window | null | undefined): PreviewSource {
  const origin = new URL(url).origin;
  return {
    url,
    onSelect(handler) {
      const listener = (e: MessageEvent) => {
        if (e.origin !== origin) return;
        const frame = getFrameWindow();
        if (!frame || e.source !== frame) return;
        const d = e.data as { type?: unknown; src?: unknown } | null;
        if (d && d.type === 'construct:select' && typeof d.src === 'string') handler(d.src);
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}
