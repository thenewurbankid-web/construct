'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useModelStatus } from '@/features/shell';
import { useDashboard } from '../hooks/useDashboard';
import { DashboardPage } from '../pages/DashboardPage';

// Composes the hook (application behavior) with the page (presentation),
// wrapped behind the project-gate feature's controller — a real,
// SLICE-002-checked cross-feature import through project-gate's public API.
export function DashboardController() {
  const dashboard = useDashboard();
  const model = useModelStatus();
  return (
    <ProjectGateController>
      <DashboardPage {...dashboard} modelOffline={model === 'offline'} />
    </ProjectGateController>
  );
}
