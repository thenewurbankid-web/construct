'use client';

import { useState } from 'react';
import { CloneController, ConnectRemoteController, useRemote } from '@/features/clone';
import { useProjectSwitcher } from '@/features/shell';
import { BranchList } from '../components/BranchList';
import { GitConnectState } from '../components/GitConnectState';
import type { BranchListProps } from '../types';

/**
 * The Git screen's "PRs" tab (#374): the branch list (today's whole review-list experience, ranked
 * with health badges) once the project has a remote, or the Connect-remote/Clone-a-repository empty
 * state (`ia-git-connect.html`) when it does not. `useRemote` and both actions are #330 slice A,
 * reused exactly as built for Settings / the Open-a-project screen -- only their position is new.
 * Not `preferred`, so it never changes what any existing route shows by default; the branch list
 * keeps rendering in the center stage exactly as before this tab existed.
 */
export function GitPrsTabController({ list }: { list: BranchListProps | null }) {
  const remote = useRemote();
  const project = useProjectSwitcher();
  const [open, setOpen] = useState<'connect' | 'clone' | null>(null);

  if (!remote.state.loaded) return <p className="hint rv-pad">Reading this project&apos;s remote...</p>;
  if (remote.state.repo && remote.state.connected) {
    return list ? <BranchList {...list} /> : <p className="hint rv-pad">Reading branches...</p>;
  }

  return (
    <GitConnectState
      open={open}
      onToggle={(which) => setOpen((cur) => (cur === which ? null : which))}
      connect={<ConnectRemoteController />}
      clone={<CloneController onCloned={project.choose} workspaceRoot={null} />}
    />
  );
}
