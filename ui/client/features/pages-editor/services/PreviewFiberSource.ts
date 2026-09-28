// Live preview v2 (#443): the Cockpit-side half of the `construct:preview:*` postMessage protocol the
// injecting proxy's bridge script speaks (packages/engine/previewFiber.mjs, design note
// docs/design/live-preview-v2.md §5). Deliberately a separate transport from `PreviewSource.ts`'s
// `construct:*` v1 protocol (data-cx-src based): the two never share a vocabulary, so a stale v1 listener
// can't misread a v2 message or vice versa.
const PROTOCOL = 'construct-preview/1';

const MESSAGES = {
  hello: 'construct:preview:hello',
  select: 'construct:preview:select',
  hover: 'construct:preview:hover',
  error: 'construct:preview:error',
  mode: 'construct:preview:mode',
  highlight: 'construct:preview:highlight',
  detach: 'construct:preview:detach',
} as const;

export type FiberSelection = {
  id: number;
  protocol: string;
  tag: string | null;
  componentName: string | null;
  annotation: string | null;
  debugSource: { fileName: string; lineNumber: number; columnNumber: number } | null;
  stack: string | null;
  ancestors: Array<{ componentName: string | null; debugSource: unknown; stack: string | null }>;
  props: Array<{ name: string; type: string; value: unknown }>;
  domPath: Array<{ tag: string; index: number }>;
  react: { version: string | null; hasDebugSource: boolean; hasDebugStack: boolean };
  truncated: string[];
};

export type FiberHover = { componentName: string | null; tag: string | null };
export type FiberBridgeError = { reason: string };

export interface FiberPreviewSource {
  readonly previewUrl: string;
  onHello(handler: (capabilities: { pick: boolean; hover: boolean; highlight: boolean }) => void): () => void;
  onSelect(handler: (selection: FiberSelection) => void): () => void;
  onHover(handler: (hover: FiberHover) => void): () => void;
  onError(handler: (error: FiberBridgeError) => void): () => void;
  /** Turns pick mode on/off in the page. */
  setPick(pick: boolean): void;
  /** Outlines a previously-received selection, by its id, without re-resolving anything. */
  highlight(id: number): void;
  /** Tells the bridge to stop posting (about to navigate the iframe away or tear the panel down). */
  detach(): void;
}

/** Nonce- and origin-gated iframe transport for the fiber bridge: only messages carrying this session's
 * nonce, from `previewUrl`'s own origin, and from the given iframe's window are accepted — the same
 * three-way check the bridge itself applies to inbound messages (§5's "both ways" contract). */
export function createFiberPreviewSource(previewUrl: string, nonce: string, getFrameWindow: () => Window | null | undefined): FiberPreviewSource {
  const origin = new URL(previewUrl).origin;

  const subscribe = <T,>(pick: (d: Record<string, unknown>) => T | null, handler: (v: T) => void) => {
    const listener = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      const frame = getFrameWindow();
      if (!frame || e.source !== frame) return;
      const d = e.data as Record<string, unknown> | null;
      if (!d || d.protocol !== PROTOCOL || d.nonce !== nonce) return;
      const v = pick(d);
      if (v !== null) handler(v);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  };

  const post = (message: Record<string, unknown>) => {
    const frame = getFrameWindow();
    frame?.postMessage({ ...message, nonce, protocol: PROTOCOL }, origin);
  };

  return {
    previewUrl,
    onHello: (handler) => subscribe((d) => (d.type === MESSAGES.hello ? (d.capabilities as { pick: boolean; hover: boolean; highlight: boolean }) : null), handler),
    onSelect: (handler) => subscribe((d) => (d.type === MESSAGES.select ? (d.selection as FiberSelection) : null), handler),
    onHover: (handler) => subscribe((d) => (d.type === MESSAGES.hover ? { componentName: d.componentName as string | null, tag: d.tag as string | null } : null), handler),
    onError: (handler) => subscribe((d) => (d.type === MESSAGES.error ? { reason: String(d.reason) } : null), handler),
    setPick: (pick) => post({ type: MESSAGES.mode, pick }),
    highlight: (id) => post({ type: MESSAGES.highlight, id }),
    detach: () => post({ type: MESSAGES.detach }),
  };
}
