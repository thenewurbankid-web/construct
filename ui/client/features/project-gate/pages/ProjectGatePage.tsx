import type { ReactNode } from 'react';
import { ProjectGateScreen } from '../components/ProjectGateScreen';
import type { ProjectStatus } from '../types';

type ProjectGatePageProps = {
  status: ProjectStatus | null;
  initializing: boolean;
  error: string | null;
  onInit: () => void;
  children: ReactNode;
};

// Presentation-only routing between the two possible states
// (PAGE-002/003/004/005): no workflow/service/domain imports, no literal
// fetch() call.
export function ProjectGatePage({ status, initializing, error, onInit, children }: ProjectGatePageProps): ReactNode {
  if (!status) return <p>Loading project status…</p>;
  if (!status.valid) {
    return <ProjectGateScreen status={status} initializing={initializing} error={error} onInit={onInit} />;
  }
  return children;
}
