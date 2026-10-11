'use client';

import { useLinePreviewRoute } from '../hooks/useLinePreviewRoute';
import { LinePreviewPage } from '../pages/LinePreviewPage';

/** /components/preview?file=<library>/components/<Name>.tsx: the chosen library component rendered alone. */
export function LinePreviewController() {
  return <LinePreviewPage route={useLinePreviewRoute()} />;
}
