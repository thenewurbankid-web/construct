// Pure (DOMAIN-001): how a chosen preview size becomes a box, and how the
// frame's real measured size reads (#456).
import type { PreviewSizeOption } from './PreviewSize.ts';

/** The frame box for a size. `maxWidth: 100%` on every one of them is what keeps a
 * device width honest: a 1280 frame in a 900px stage narrows to 900 and the readout says so. */
export function previewFrameStyle(option: PreviewSizeOption): { width: string; maxWidth: string } {
  return {
    width: option.width === null ? '100%' : `${option.width}px`,
    maxWidth: option.maxWidth === null ? '100%' : `min(100%, ${option.maxWidth}px)`,
  };
}

/** `1280 x 720 px`, rounded — what the frame actually measures right now. Empty while unmeasured. */
export function previewSizeReadout(size: { width: number; height: number } | null): string {
  if (!size || size.width <= 0 || size.height <= 0) return '';
  return `${Math.round(size.width)} × ${Math.round(size.height)} px`;
}
