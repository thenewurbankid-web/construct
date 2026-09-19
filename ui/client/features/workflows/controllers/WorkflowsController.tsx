'use client';

import { useEffect } from 'react';
import { ProjectGateController } from '@/features/project-gate';
import { useRegisterShellTab, useRevealPane } from '@/features/shell';
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

  // Once a file is open its tabs are useful: open the Tools panel.
  const reveal = useRevealPane();
  const fileOpen = !!workflows.loaded;
  useEffect(() => {
    if (fileOpen) reveal('right');
  }, [fileOpen, workflows.file, reveal]);

  return (
    <ProjectGateController>
      <WorkflowsPage {...workflows} />
    </ProjectGateController>
  );
}
