'use client';

import { usePaneResizer } from '../hooks/usePaneResizer';
import type { PaneResizerProps } from '../types';

/** A focusable separator between panes (WAI-ARIA window splitter). Drag it with
 * the mouse, or focus it and use the arrow keys (Shift = bigger step, Home/End =
 * limits, Enter or double-click = collapse the pane). */
export function PaneResizer(props: PaneResizerProps) {
  const handlers = usePaneResizer(props);
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={props.orientation}
      aria-label={props.label}
      aria-valuenow={props.value}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-controls={props.controls}
      className={`sh-resizer sh-resizer--${props.orientation}`}
      data-testid={`resizer-${props.controls ?? props.label}`}
      {...handlers}
    />
  );
}
