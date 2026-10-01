// Public API for feature: live-preview (#834/#837 -- extracted out of pages-editor, the first and
// only consumer until now, so Features/Tests/Git can embed the same preview instead of a second copy).

/** What the panel is handed to draw, and the device-size/reach/plugin vocabulary. */
export type * from './domain/LivePreviewView';

/** #835 -- the rect/rect-query shapes `usePreview`'s `requestRects` takes and resolves. */
export type { PreviewRect, PreviewRectQuery } from './services/PreviewSource';

/** The preview of a dev server in an iframe: toolbar, empty/connecting states, the frame itself. */
export * from './components/LivePreviewPanel';

/** Live preview state: URL, click-to-source (resolved by the caller), device size, full screen. */
export * from './hooks/usePreview';

/** Frames the address a dev server announces (started elsewhere, e.g. the `dev-server` feature's card). */
export * from './hooks/usePreviewServerUrl';
