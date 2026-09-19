import type { ReactNode } from 'react';
import { ErrorState, LoadingState } from '@/features/states';
import { ProjectGateScreen } from '../components/ProjectGateScreen';
import type { ProjectStatus } from '../types';

type ProjectGatePageProps = {
  status: ProjectStatus | null;
  initializing: boolean;
  error: string | null;
  onInit: () => void;
  loadError: string | null;
  onRetry: () => void;
  children: ReactNode;
};

// Presentation-only routing between the two possible states
// (PAGE-002, PAGE-003, PAGE-004, PAGE-005): no application-layer imports,
// no literal network call.
export function ProjectGatePage({ status, initializing, error, onInit, loadError, onRetry, children }: ProjectGatePageProps): ReactNode {
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
  if (!status.valid) {
    return <ProjectGateScreen status={status} initializing={initializing} error={error} onInit={onInit} />;
  }
  return children;
}
