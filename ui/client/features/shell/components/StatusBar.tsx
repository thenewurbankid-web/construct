import type { StatusBarProps } from '../types';

/** The 24px bottom status bar: drawer toggle and the shortcut hints. */
export function StatusBar({ layout, onTogglePane, shortcuts, validateStatus, onOpenDiagnostics }: StatusBarProps) {
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
      <button type="button" className="sh-status-btn" data-testid="status-validate" onClick={onOpenDiagnostics} title="Open Diagnostics">
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
