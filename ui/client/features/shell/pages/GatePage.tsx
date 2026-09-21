import type { ReactNode } from 'react';
import { GateTopBar } from '../components/GateTopBar';
import type { ShellMode } from '../types';

type GatePageProps = {
  mode: Exclude<ShellMode, 'full'>;
  userMenu?: ReactNode;
  /** The full-screen "Open a project" screen (another feature's controller, composed by the shell controller). */
  gate: ReactNode;
  /** Shown while the project state is still unknown. */
  loading: ReactNode;
  /** The route's own content; shown only for the profile-menu pages that need no project. */
  children: ReactNode;
};

// Presentation-only composition (PAGE-002..006) of the frame shown while no project is open: the minimal top
// bar over one full-width stage. No rail, panes, drawer, status bar or palette.
export function GatePage({ mode, userMenu, gate, loading, children }: GatePageProps): ReactNode {
  return (
    <div className="sh-root sh-root--gate" data-testid="shell-gate">
      <GateTopBar userMenu={userMenu} />
      <main className="main">{mode === 'loading' ? loading : mode === 'gate' ? gate : children}</main>
    </div>
  );
}
