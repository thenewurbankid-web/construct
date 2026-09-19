import type { CSSProperties } from 'react';
import { PaneResizer } from './PaneResizer';
import type { ShellLayoutProps } from '../types';

/** The 3-pane frame: top bar, Browser (left) | stage (middle) | Tools (right),
 * an optional bottom drawer and a status bar. Every region is a slot; panes are
 * resizable (drag or arrow keys) and collapsible. Presentation only: sizes and
 * limits come in as props. */
export function ShellLayout({ layout, limits, onResize, onTogglePane, top, left, mid, right, drawer, status }: ShellLayoutProps) {
  const style = { '--sh-drawer-h': layout.drawer.open ? `${layout.drawer.size}px` : '0px' } as CSSProperties;
  return (
    <div className="sh-root" style={style}>
      {top}
      <div className="sh-body">
        {layout.left.open && (
          <>
            <aside id="sh-pane-left" data-pane="left" tabIndex={-1} aria-label="Browser" className="sh-pane sh-left" style={{ width: layout.left.size }}>
              {left}
            </aside>
            <PaneResizer
              orientation="vertical"
              label="Resize Browser pane"
              controls="sh-pane-left"
              value={layout.left.size}
              min={limits.left.min}
              max={limits.left.max}
              onResize={(size) => onResize('left', size)}
              onToggle={() => onTogglePane('left')}
            />
          </>
        )}
        <div id="sh-mid" data-pane="mid" tabIndex={-1} className="sh-mid">
          {mid}
        </div>
        {layout.right.open && (
          <>
            <PaneResizer
              orientation="vertical"
              label="Resize Tools panel"
              controls="sh-pane-right"
              invert
              value={layout.right.size}
              min={limits.right.min}
              max={limits.right.max}
              onResize={(size) => onResize('right', size)}
              onToggle={() => onTogglePane('right')}
            />
            <aside id="sh-pane-right" data-pane="right" tabIndex={-1} aria-label="Tools" className="sh-pane sh-right" style={{ width: layout.right.size }}>
              {right}
            </aside>
          </>
        )}
      </div>
      {layout.drawer.open && (
        <section id="sh-pane-drawer" data-pane="drawer" tabIndex={-1} aria-label="Drawer" className="sh-drawer" style={{ height: layout.drawer.size }}>
          <PaneResizer
            orientation="horizontal"
            label="Resize drawer"
            controls="sh-pane-drawer"
            invert
            value={layout.drawer.size}
            min={limits.drawer.min}
            max={limits.drawer.max}
            onResize={(size) => onResize('drawer', size)}
            onToggle={() => onTogglePane('drawer')}
          />
          {drawer}
        </section>
      )}
      {status}
    </div>
  );
}
