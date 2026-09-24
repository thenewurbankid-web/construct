import type { ShellTab } from '@/features/shell';
import { NotesBrowser } from '../components/NotesBrowser';
import type { NotesBrowserProps } from '../types';

// Presentation-only: the Notes screen's list as a shell tab (Browser), registered into the shell's slot registry
// by the controller while the screen is mounted.
export function notesShellTabs(browser: NotesBrowserProps): { browser: ShellTab } {
  return {
    browser: { id: 'notes-saved', title: 'Saved notes', preferred: true, badge: browser.status === 'ready' ? browser.rows.length : null, render: () => <NotesBrowser {...browser} /> },
  };
}
