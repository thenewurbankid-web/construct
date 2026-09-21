import type { ReactNode } from 'react';
import type { ShellMode } from '../types';
import { GatePage } from './GatePage';

type ShellRootPageProps = {
  mode: ShellMode;
  userMenu?: ReactNode;
  /** The full shell, and the palette that only exists with it (built by the controller, rendered only for `full`). */
  full: ReactNode;
  palette: ReactNode;
  gate: ReactNode;
  loading: ReactNode;
  children: ReactNode;
};

// Presentation-only choice between the full shell (a project is open) and the minimal gate frame (none is).
export function ShellRootPage({ mode, userMenu, full, palette, gate, loading, children }: ShellRootPageProps): ReactNode {
  if (mode === 'full') {
    return (
      <>
        {full}
        {palette}
      </>
    );
  }
  return (
    <GatePage mode={mode} userMenu={userMenu} gate={gate} loading={loading}>
      {children}
    </GatePage>
  );
}
