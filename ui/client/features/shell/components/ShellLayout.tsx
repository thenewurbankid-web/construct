import type { CSSProperties } from 'react';
import { NarrowTabBar } from './NarrowTabBar';
import { PaneResizer } from './PaneResizer';
import type { ShellLayoutProps } from '../types';

/** The 3-pane frame: top bar, Browser (left) | stage (middle) | Tools (right),
 * an optional bottom drawer and a status bar. Every region is a slot; panes are
 * resizable (drag or arrow keys) and collapsible. Presentation only: sizes and
 * limits come in as props. */
export function ShellLayout({ layout, limits, onResize, onTogglePane, narrow = false, narrowPane = 'mid', onNarrowPane, top, rail, left, mid, right, drawer, status }: ShellLayoutProps) {
  if (narrow) {
    // Narrow (< 900px): one pane at a time. Inactive panes stay mounted but hidden
    // so a screen keeps its state (a wizard chat, a half-filled form) while you
    // look at the Browser or Tools; the drawer is not shown at this size.
    return (
      <div className="sh-root sh-root--narrow" data-narrow="true">
        {top}
        <div className="sh-body">
          <aside id="sh-pane-left" data-pane="left" tabIndex={-1} aria-label="Browser" className="sh-pane sh-left" hidden={narrowPane !== 'left'}>
            {left}
          </aside>
          <div id="sh-mid" data-pane="mid" tabIndex={-1} className="sh-mid" hidden={narrowPane !== 'mid'}>
            {mid}
          </div>
          <aside id="sh-pane-right" data-pane="right" tabIndex={-1} aria-label="Tools" className="sh-pane sh-right" hidden={narrowPane !== 'right'}>
            {right}
          </aside>
        </div>
        {rail}
        <NarrowTabBar pane={narrowPane} onSelect={(p) => onNarrowPane?.(p)} />
        {status}
      </div>
    );
  }
  const style = { '--sh-drawer-h': layout.drawer.open ? `${layout.drawer.size}px` : '0px' } as CSSProperties;
  return (
    <div className="sh-root" style={style}>
      {top}
      <div className="sh-body">
        {rail}
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
