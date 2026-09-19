'use client';

import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { resizeByKey, sizeFromDrag } from '../domain/PaneSizing';
import type { PaneResizerProps } from '../types';

type DragState = { from: number; start: number } | null;

const axisOf = (orientation: PaneResizerProps['orientation'], e: PointerEvent) =>
  orientation === 'vertical' ? e.clientX : e.clientY;

/** Pointer-drag handlers (pointer capture keeps the drag alive outside the handle). */
function useDrag({ orientation, value, min, max, invert = false, onResize }: PaneResizerProps) {
  const drag = useRef<DragState>(null);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { from: axisOf(orientation, e), start: value };
    },
    [value, orientation],
  );
  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      onResize(sizeFromDrag(drag.current.start, axisOf(orientation, e) - drag.current.from, invert, min, max));
    },
    [invert, min, max, onResize, orientation],
  );
  const onPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

/** Pointer-drag and keyboard behaviour of a pane separator (WAI-ARIA window
 * splitter): arrows resize (Shift = big step), Home/End jump to the limits,
 * Enter collapses the pane, double-click collapses too. */
export function usePaneResizer(props: PaneResizerProps) {
  const { orientation, value, min, max, invert = false, onResize, onToggle } = props;
  const pointer = useDrag(props);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onToggle();
        return;
      }
      const next = resizeByKey(e.key, e.shiftKey, value, min, max, orientation, invert);
      if (next === null) return;
      e.preventDefault();
      onResize(next);
    },
    [value, min, max, orientation, invert, onResize, onToggle],
  );

  return { ...pointer, onKeyDown, onDoubleClick: onToggle };
}
