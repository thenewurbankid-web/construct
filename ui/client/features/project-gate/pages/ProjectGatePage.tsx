import type { ComponentProps, ReactNode } from 'react';
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
  /** #365: the "Open a project" screen (a slot: its own controller), shown while no project is open. */
  openProject: ReactNode;
  children: ReactNode;
};

// Presentation-only routing between the possible states
// (PAGE-002, PAGE-003, PAGE-004, PAGE-005): no application-layer imports,
// no literal network call.
export function ProjectGatePage({ status, initializing, error, onInit, loadError, onRetry, openProject, children }: ProjectGatePageProps): ReactNode {
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
  if (status.noProject || status.projectDir === null) return openProject;
  if (!status.valid) {
    return <ProjectGateScreen status={status} initializing={initializing} error={error} onInit={onInit} />;
  }
  return children;
}

// Presentation-only: the "Open a project" screen, composed from props.
export function OpenProjectPage(props: ComponentProps<typeof NoProjectScreen>): ReactNode {
  return <NoProjectScreen {...props} />;
}
