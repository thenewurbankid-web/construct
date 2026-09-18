'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useWorkflows } from '../hooks/useWorkflows';
import { WorkflowsPage } from '../pages/WorkflowsPage';

export function WorkflowsController() {
  const workflows = useWorkflows();
  return (
    <ProjectGateController>
      <WorkflowsPage {...workflows} />
    </ProjectGateController>
  );
}
