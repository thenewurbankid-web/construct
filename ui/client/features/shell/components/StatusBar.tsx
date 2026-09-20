import type { CSSProperties } from 'react';
import type { StatusBarProps } from '../types';

/** The 24px bottom status bar: drawer toggle and the shortcut hints. */
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
      <span className="sh-hints">
        {shortcuts.map((s) => (
          <span key={s.action} className="sh-hint">
            <kbd>{s.keys}</kbd> {s.label}
          </span>
        ))}
      </span>
    </footer>
  );
}
