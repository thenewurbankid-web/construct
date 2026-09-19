'use client';

import type { KeyboardEvent } from 'react';
import type { ProjectSwitcherProps } from '../types';

/** Top-bar project switcher: shows the current local project and opens a
 * popover with the shared folder picker (supplied as a slot). Esc closes it. */
export function ProjectSwitcher({ label, dir, open, onToggle, onClose, picker, error }: ProjectSwitcherProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="sh-project" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="sh-project-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="sh-project-popover"
        data-testid="project-switcher"
        title={dir ?? 'No project selected'}
        onClick={onToggle}
      >
        <span className="sh-project-name">{label}</span>
        <span aria-hidden="true"> ▾</span>
      </button>
      {open && (
        <div id="sh-project-popover" role="dialog" aria-label="Switch project" className="sh-popover">
          <p className="hint">Pick a local folder to work on. Everything in Construct then uses that project.</p>
          {error && (
            <p className="status-error" role="alert">
              {error}
            </p>
          )}
          {picker}
        </div>
      )}
    </div>
  );
}
