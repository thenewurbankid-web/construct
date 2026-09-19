'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useRegisterShellTab } from '@/features/shell';
import '../components/workflows-shell.css';
import { useWorkflows } from '../hooks/useWorkflows';
import { WorkflowsPage } from '../pages/WorkflowsPage';
import { workflowsShellTabs } from '../pages/WorkflowsShellTabs';

/** The diagram is the stage (this page's children slot); the browser list and
 * the Narrative / Context & actions / Edit tabs are registered into the
 * shell's Browser and Tools panels while this screen is mounted. */
export function WorkflowsController() {
  const workflows = useWorkflows();
  const tabs = workflowsShellTabs(workflows);
  useRegisterShellTab('browser', tabs.browser);
  useRegisterShellTab('tools', tabs.narrative);
  useRegisterShellTab('tools', tabs.context);
  useRegisterShellTab('tools', tabs.edit);

  return (
    <ProjectGateController>
      <WorkflowsPage {...workflows} />
    </ProjectGateController>
  );
}
