'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useDashboard } from '../hooks/useDashboard';
import { DashboardPage } from '../pages/DashboardPage';

// Composes the hook (application behavior) with the page (presentation),
// wrapped behind the project-gate feature's controller — a real,
// SLICE-002-checked cross-feature import through project-gate's public API.
export function DashboardController() {
  const dashboard = useDashboard();
  return (
    <ProjectGateController>
      <DashboardPage {...dashboard} />
    </ProjectGateController>
  );
}
