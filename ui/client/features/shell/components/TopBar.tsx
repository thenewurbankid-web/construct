import Link from 'next/link';
import type { ModelStatus, TopBarProps } from '../types';

const MODEL_TEXT: Record<ModelStatus, string> = {
  checking: 'Local model: checking',
  ready: 'Local model ready',
  offline: 'Local model offline',
};

/** The 44px top bar: brand, project switcher slot, mode switch, status pills,
 * pane toggles and the theme switch slot. Modes are real links to existing
 * screens; the active one carries aria-current. */
export function TopBar({
  modes,
  activeModeId,
  projectSwitcher,
  themeToggle,
  modelStatus,
  runningProcesses,
  layout,
  onTogglePane,
  onOpenProcesses,
  onOpenPalette,
}: TopBarProps) {
  return (
    <header className="sh-top" role="banner">
      <span className="sh-brand">Cockpit</span>
      {projectSwitcher}
      <nav aria-label="Modes" className="sh-modes">
        {modes.map((mode) => (
          <Link
            key={mode.id}
            href={mode.href}
            className={mode.id === activeModeId ? 'sh-mode sh-mode--active' : 'sh-mode'}
            aria-current={mode.id === activeModeId ? 'page' : undefined}
          >
            {mode.label}
          </Link>
        ))}
      </nav>
      <span className="sh-spacer" />
      <button
        type="button"
        className="sh-palette-trigger"
        data-testid="palette-trigger"
        aria-haspopup="dialog"
        aria-label="Open command palette"
        title="Search screens and run commands (Ctrl K)"
        onClick={onOpenPalette}
      >
        <span>Search screens or run a command...</span>
        <kbd>Ctrl K</kbd>
      </button>
      <span className="sh-spacer" />
      <button
        type="button"
        className="sh-pill"
        data-testid="pill-processes"
        onClick={onOpenProcesses}
      >
        Processes: {runningProcesses}
      </button>
      <span className={`sh-pill sh-pill--${modelStatus}`} aria-live="polite" data-testid="pill-model">
        <span className="sh-dot" aria-hidden="true" />
        <span className="sh-pill-text">{MODEL_TEXT[modelStatus]}</span>
      </span>
      <button
        type="button"
        className="sh-icon-btn sh-toggle"
        aria-label="Browser pane"
        aria-expanded={layout.left.open}
        aria-controls="sh-pane-left"
        data-testid="toggle-left"
        title="Show or hide the Browser pane (Ctrl B)"
        onClick={() => onTogglePane('left')}
      >
        <span aria-hidden="true">Browser</span>
      </button>
      <button
        type="button"
        className="sh-icon-btn sh-toggle"
        aria-label="Tools panel"
        aria-expanded={layout.right.open}
        aria-controls="sh-pane-right"
        data-testid="toggle-right"
        title="Show or hide the Tools panel (Ctrl Alt B)"
        onClick={() => onTogglePane('right')}
      >
        <span aria-hidden="true">Tools</span>
      </button>
      {themeToggle}
    </header>
  );
}
