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
// (PAGE-002, PAGE-003, PAGE-004, PAGE-005): no application-layer imports,
// no literal network call.
export function ProjectGatePage({ status, initializing, error, onInit, children }: ProjectGatePageProps): ReactNode {
  if (!status) return <p>Loading project status…</p>;
  if (!status.valid) {
    return <ProjectGateScreen status={status} initializing={initializing} error={error} onInit={onInit} />;
  }
  return children;
}
