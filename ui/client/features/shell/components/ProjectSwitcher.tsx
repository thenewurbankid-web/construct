'use client';

import { useRef } from 'react';
import { useDismissable } from '@/lib/useDismissable';
import type { ProjectSwitcherProps } from '../types';
import { WorkspaceFolderTag } from './WorkspaceFolderBox';

/** Top-bar project switcher: shows the current local project and opens a
 * popover with the shared folder picker (supplied as a slot). Dismissal (Escape with
 * focus return, outside click, Tab out) is the shared useDismissable contract. */
export function ProjectSwitcher({ label, dir, open, onToggle, onClose, picker, error, onCloseProject, workspace, workspaceBox }: ProjectSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  useDismissable({ open, onClose, triggerRef, surfaceRef, id: 'project-switcher' });
  return (
    <div className="sh-project">
      <button
        ref={triggerRef}
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
        <WorkspaceFolderTag folder={workspace} />
        <span aria-hidden="true"> ▾</span>
      </button>
      {open && (
        <div ref={surfaceRef} id="sh-project-popover" role="dialog" aria-label="Switch project" className="sh-popover">
          {workspaceBox}
          <p className="hint">To open another project, close this one or pick one below. Everything in Construct then uses that project.</p>
          {dir && onCloseProject && (
            <button type="button" className="ui-button ui-button--ghost" data-testid="close-project" onClick={onCloseProject}>
              Close project
            </button>
          )}
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
