import type { ReactNode } from 'react';
import { ErrorState, LoadingState } from '@/features/states';
import { NoProjectScreen } from '../components/NoProjectScreen';
import { ProjectGateScreen } from '../components/ProjectGateScreen';
import type { ProjectStatus } from '../types';

type ProjectGatePageProps = {
  status: ProjectStatus | null;
  initializing: boolean;
  error: string | null;
  onInit: () => void;
  loadError: string | null;
  onRetry: () => void;
  /** #365: opening a folder as the project, and the workspace-scoped picker (a slot: another feature's controller). */
  opening: boolean;
  openError: string | null;
  onOpen: (dir: string) => void;
  picker: ReactNode;
  /** The New project form, shown on the Open-a-project screen. */
  newProject?: ReactNode;
  /** The clone-a-repository form, shown on the Open-a-project screen. */
  clone?: ReactNode;
  /** Absolute path of the `shop` sample folder when the workspace has one (else null), and whether that is still being looked up. */
  samplePath?: string | null;
  sampleLoading?: boolean;
  children: ReactNode;
};

// Presentation-only routing between the possible states
// (PAGE-002, PAGE-003, PAGE-004, PAGE-005): no application-layer imports,
// no literal network call.
export function ProjectGatePage({ status, initializing, error, onInit, loadError, onRetry, opening, openError, onOpen, picker, newProject, clone, samplePath = null, sampleLoading = false, children }: ProjectGatePageProps): ReactNode {
  if (!status) {
    return (
      <div className="page page--screen">
        {loadError ? (
          <ErrorState title="Could not load the project status" hint={loadError} onRetry={onRetry} />
        ) : (
          <LoadingState label="Loading project status" hint="Checking that this folder is a Construct project." />
        )}
      </div>
    );
  }
  if (status.noProject || status.projectDir === null) {
    return <NoProjectScreen workspaceRoot={status.workspaceRoot ?? null} lastProject={status.lastProject ?? null} opening={opening} error={openError} onOpen={onOpen} picker={picker} newProject={newProject} clone={clone} samplePath={samplePath} sampleLoading={sampleLoading} />;
  }
  if (!status.valid) {
    return <ProjectGateScreen status={status} initializing={initializing} error={error} onInit={onInit} />;
  }
  return children;
}
