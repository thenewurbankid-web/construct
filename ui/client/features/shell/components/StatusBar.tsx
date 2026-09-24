import type { CSSProperties } from 'react';
import type { StatusBarProps } from '../types';

/** The 24px bottom status bar: drawer toggle, validate result and the one "? Shortcuts" button. */
export function StatusBar({ layout, onTogglePane, shortcuts, validateStatus, validateStatusChars = 0, onOpenDiagnostics }: StatusBarProps) {
  return (
    <footer className="sh-status" role="contentinfo">
      <button
        type="button"
        className="sh-status-btn"
        aria-expanded={layout.drawer.open}
        aria-controls="sh-pane-drawer"
        data-testid="toggle-drawer"
        onClick={() => onTogglePane('drawer')}
      >
        Drawer
      </button>
      {/* Reserved up front for the longest text it can ever show, so a background
          validate landing changes what it says without changing how much room it
          takes (#252). In `ch`, so it follows the font and the zoom, and with no
          gauge text in the DOM -- a hidden copy of every possible string would
          land in textContent and quietly weaken every test that reads this. */}
      <button
        type="button"
        className="sh-status-btn sh-status-btn--gauged"
        style={{ '--sh-gauge': validateStatusChars } as CSSProperties}
        data-testid="status-validate"
        onClick={onOpenDiagnostics}
        title="Open Diagnostics"
      >
        {validateStatus}
      </button>
      <span className="sh-spacer" />
      {/* #391: one hint instead of four. The list itself lives in the Tools panel's Project tab, and the tooltip
          carries it too; the button opens that panel. */}
      <span className="sh-hints">
        <button
          type="button"
          className="sh-status-btn"
          data-testid="status-shortcuts"
          title={shortcuts.map((s) => `${s.keys}: ${s.label}`).join('\n')}
          onClick={() => {
            if (!layout.right.open) onTogglePane('right');
          }}
        >
          <kbd>?</kbd> Shortcuts
        </button>
      </span>
    </footer>
  );
}
