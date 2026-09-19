import type { ShellTab } from '@/features/shell';
import { MachineContextPanel } from '../components/MachineContextPanel';
import { MachineNarrative } from '../components/MachineNarrative';
import { WorkflowEditPanel } from '../components/WorkflowEditPanel';
import { WorkflowsBrowser } from '../components/WorkflowsBrowser';
import type { WorkflowsPageProps } from './WorkflowsPage';

export type WorkflowsShellTabs = { browser: ShellTab; narrative: ShellTab; context: ShellTab; edit: ShellTab };

// Presentation-only: the Workflows screen's pieces as shell tabs (Browser:
// Workflows; Tools: Narrative, Context & actions, Edit). The controller
// registers these into the shell's slot registry; the panels themselves are
// the same components the page used to stack under the diagram.
export function workflowsShellTabs(p: WorkflowsPageProps): WorkflowsShellTabs {
  const machine = p.loaded && !p.loaded.error ? (p.loaded.machines[p.machineIndex] ?? null) : null;
  const locked = !!p.pending || p.editBusy;
  const canEdit = !!machine && !machine.error && !locked;
  const nothing = (what: string) => <p className="hint wf-tab-empty">{what}</p>;
  const key = `${p.file}:${p.machineIndex}`;

  return {
    browser: {
      id: 'workflows',
      title: 'Workflows',
      preferred: true,
      render: () => (
        <WorkflowsBrowser
          feature={p.feature}
          onFeatureChange={p.setFeature}
          features={p.features}
          file={p.file}
          onOpen={p.openFile}
          files={p.files}
          loading={p.filesLoading}
          machines={p.loaded && !p.loaded.error ? p.loaded.machines : []}
          machineIndex={p.machineIndex}
          onPickMachine={p.pickMachine}
        />
      ),
    },
    narrative: {
      id: 'narrative',
      title: 'Narrative',
      preferred: true,
      disabled: !machine,
      render: () => {
        const nar = p.narrative?.machines[p.machineIndex];
        return nar ? <MachineNarrative key={key} narrative={nar} /> : nothing('The plain-English narrative is not available for this machine.');
      },
    },
    context: {
      id: 'context',
      title: 'Context & actions',
      disabled: !machine,
      render: () => (machine ? <MachineContextPanel key={key} machine={machine} machineIndex={p.machineIndex} disabled={!canEdit} onEdit={p.proposeEdit} /> : nothing('Open a workflow file to see its context.')),
    },
    edit: {
      id: 'edit',
      title: 'Edit',
      disabled: !machine,
      render: () =>
        machine ? (
          <WorkflowEditPanel
            key={key}
            machine={machine}
            machineIndex={p.machineIndex}
            disabled={!canEdit}
            eventName={p.eventName}
            onEventNameChange={p.setEventName}
            selectedTransition={p.selectedEdge}
            onEdit={(req) => {
              p.setSelectedEdge(null);
              p.proposeEdit(req);
            }}
          />
        ) : (
          nothing('Open a workflow file to edit it.')
        ),
    },
  };
}
