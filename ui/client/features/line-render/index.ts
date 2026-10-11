// Public API for feature: line-render
import { createElement } from 'react';
import { LineComponentPreview as Preview } from './components/LineComponentPreview';

/** The shapes of GET /api/line/render (a typed mirror of RenderResult in packages/engine/line/contract.mjs). */
export type * from './types';

/** One library component rendered alone with its props; drop it into any screen with `file` (root-relative,
 * under `<library>/components`). */
export function LineComponentPreview(props: { file: string }) {
  return createElement(Preview, props);
}

/** The preview's state (picture, prop rows, re-render on a changed value), for a screen that lays it out itself. */
export * from './hooks/useLineRender';

/** /components/preview?file=: the preview on its own. */
export * from './controllers/LinePreviewController';

/** /components/preview's address: the chosen file and its name. */
export * from './hooks/useLinePreviewRoute';
