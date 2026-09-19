// Pure (DOMAIN-001): pane sizing math for the resizers (mouse and keyboard).

export function clampSize(size: number, min: number, max: number): number {
  if (!Number.isFinite(size)) return min;
  return Math.min(max, Math.max(min, Math.round(size)));
}

/** New size after dragging the separator by `delta` px from where it started.
 * `invert` = the pane grows when the pointer moves toward the start (right
 * pane, bottom drawer). */
export function sizeFromDrag(start: number, delta: number, invert: boolean, min: number, max: number): number {
  return clampSize(start + (invert ? -delta : delta), min, max);
}

const STEP = 16;
const BIG_STEP = 64;

/** Keyboard behaviour of a separator: arrows resize (Shift = big step),
 * Home/End jump to min/max. Returns null for keys the separator ignores.
 * `orientation` is the separator's: 'vertical' uses Left/Right, 'horizontal'
 * uses Up/Down (Up grows a bottom drawer). */
export function resizeByKey(
  key: string,
  shiftKey: boolean,
  value: number,
  min: number,
  max: number,
  orientation: 'vertical' | 'horizontal',
  invert: boolean,
): number | null {
  const step = shiftKey ? BIG_STEP : STEP;
  if (key === 'Home') return min;
  if (key === 'End') return max;
  const grow = orientation === 'vertical' ? (invert ? 'ArrowLeft' : 'ArrowRight') : invert ? 'ArrowUp' : 'ArrowDown';
  const shrink = orientation === 'vertical' ? (invert ? 'ArrowRight' : 'ArrowLeft') : invert ? 'ArrowDown' : 'ArrowUp';
  if (key === grow) return clampSize(value + step, min, max);
  if (key === shrink) return clampSize(value - step, min, max);
  return null;
}
