import { AnimatedLogo } from '@/components/ui';
import type { ModelStatus, TopBarProps } from '../types';

const MODEL_TEXT: Record<ModelStatus, string> = {
  checking: 'Local model: checking',
  ready: 'Local model ready',
  offline: 'Local model offline',
};

/** The 44px top bar: brand, project switcher slot, status pills,
 * pane toggles and the profile menu slot. The five screens live in the left rail
 * (ActivityBar), not here.
 *
 * #273: the status pills carry their label in a `.sh-pill-text` span so the
 * <=1280px tier can visually hide the words (clip, not `display: none`) and
 * leave an icon + count behind, without losing the accessible name, the
 * aria-live announcement or the hover title. */
export function TopBar({
  projectSwitcher,
  userMenu,
  modelStatus,
  runningProcesses,
  layout,
  onTogglePane,
  onOpenProcesses,
  onOpenPalette,
}: TopBarProps) {
  return (
    <header className="sh-top" role="banner">
      <span className="sh-brand">
        <AnimatedLogo mark="cockpit" size={22} />
        <span>Cockpit</span>
      </span>
      {projectSwitcher}
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
        title="Running processes - open the Processes drawer"
        onClick={onOpenProcesses}
      >
        <svg className="sh-pill-icon" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
          <rect x="0.5" y="6" width="2.5" height="5" rx="1.1" />
          <rect x="4.75" y="3" width="2.5" height="8" rx="1.1" />
          <rect x="9" y="1" width="2.5" height="10" rx="1.1" />
        </svg>
        <span className="sh-pill-text">Processes:</span>{' '}
        <span className="sh-pill-count">{runningProcesses}</span>
      </button>
      <span
        className={`sh-pill sh-pill--${modelStatus}`}
        aria-live="polite"
        data-testid="pill-model"
        title={MODEL_TEXT[modelStatus]}
      >
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
      {userMenu}
    </header>
  );
}
