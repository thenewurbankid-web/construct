'use client';

import { useMemo } from 'react';
import { ScreenModesController } from '@/features/line-modes';
import { ProjectGateController } from '@/features/project-gate';
import { useRegisterShellTab } from '@/features/shell';
import type { Place } from '@/lib/lineModes';
import '../components/workflows-shell.css';
import { WORKFLOWS_MODES } from '../domain/WorkflowsModes';
import { useWorkflows } from '../hooks/useWorkflows';
import { useWorkflowsUrl } from '../hooks/useWorkflowsUrl';
import { WorkflowsPage } from '../pages/WorkflowsPage';
import { workflowsShellTabs } from '../pages/WorkflowsShellTabs';

const idAt = (place: Place, param: string) => place.steps.find((s) => s.param === param)?.id ?? '';

/** The diagram is the stage (this page's children slot); the browser list and
 * the Narrative / Context & actions / Edit tabs are registered into the
 * shell's Browser and Tools panels while this screen is mounted. Two modes: the
 * same screen as a chat (open a feature, then a workflow) or under the hood. */
export function WorkflowsController() {
  const workflows = useWorkflows();
  const tabs = workflowsShellTabs(workflows);
  useRegisterShellTab('browser', tabs.browser);
  useRegisterShellTab('tools', tabs.narrative);
  useRegisterShellTab('tools', tabs.context);
  useRegisterShellTab('tools', tabs.edit);
  const { features, feature, files, filesLoading } = workflows;
  useWorkflowsUrl(feature, workflows.file);
  const data = useMemo(() => ({ features, feature, files, filesLoading }), [features, feature, files, filesLoading]);
  const onPlace = (place: Place) => void workflows.goTo(idAt(place, 'feature'), idAt(place, 'file'));

  return (
    <ProjectGateController>
      <ScreenModesController provider={WORKFLOWS_MODES} data={data} hood={<WorkflowsPage {...workflows} />} onPlace={onPlace} />
    </ProjectGateController>
  );
}
