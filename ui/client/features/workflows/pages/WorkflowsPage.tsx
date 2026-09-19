import type { ReactNode } from 'react';
import { MachineCanvas } from '../components/MachineCanvas';
import { WorkflowDiffPreview } from '../components/WorkflowDiffPreview';
import type { NarrativeView, PendingWorkflowEdit, SelectedEdge, WorkflowEditRequest, WorkflowFileMachines, WorkflowsState } from '../types';

export type WorkflowsPageProps = WorkflowsState & {
  narrative: NarrativeView | null;
  machineIndex: number;
  pickMachine: (index: number) => void;
  eventName: string;
  setEventName: (name: string) => void;
  selectedEdge: SelectedEdge | null;
  hint: string | null;
  setHint: (hint: string | null) => void;
  setSelectedEdge: (edge: SelectedEdge | null) => void;
  setFeature: (feature: string) => void;
  openFile: (file: string) => void;
  reload: () => void;
  proposeEdit: (req: WorkflowEditRequest) => void;
  confirmEdit: () => void;
  cancelEdit: () => void;
};

type LoadedFileProps = { loaded: WorkflowFileMachines; onEdit: (req: WorkflowEditRequest) => void; locked: boolean; view: Pick<WorkflowsPageProps, 'machineIndex' | 'pickMachine' | 'eventName' | 'hint' | 'setHint' | 'setSelectedEdge'> };

function LoadedFile({ loaded, onEdit, locked, view }: LoadedFileProps): ReactNode {
  if (loaded.error) {
    return (
      <p className="status-error" data-testid="wf-file-error">
        Can&apos;t visualize this file — {loaded.error}
      </p>
    );
  }
  if (loaded.machines.length === 0) {
    return <p className="hint" data-testid="wf-no-machines">No XState machine (<code>createMachine</code>) found in {loaded.path}.</p>;
  }
  return (
    <>
      {loaded.machines.map((m, i) => (
        <MachineCanvas
          key={`${m.id}:${i}`}
          machine={m}
          machineIndex={i}
          onEdit={onEdit}
          locked={locked}
          active={i === view.machineIndex}
          onActivate={view.pickMachine}
          eventName={view.eventName}
          hint={view.hint}
          onHint={view.setHint}
          onSelectEdge={view.setSelectedEdge}
        />
      ))}
    </>
  );
}

function PendingEdit({ pending, busy, onConfirm, onCancel }: { pending: PendingWorkflowEdit; busy: boolean; onConfirm: () => void; onCancel: () => void }): ReactNode {
  return <WorkflowDiffPreview hunks={pending.hunks} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />;
}

// The stage (middle pane): the machine diagram(s) of the open workflow file.
// The browser list and the Narrative / Context & actions / Edit tabs live in
// the shell's Browser and Tools panels (see WorkflowsShellTabs).
export function WorkflowsPage(props: WorkflowsPageProps): ReactNode {
  const { feature, file, reload, loaded, error } = props;
  const { pending, editBusy, editError, proposeEdit, confirmEdit, cancelEdit } = props;
  return (
    <div className="wf-stage" data-testid="wf-stage">
      <div className="wf-toolbar">
        <h1>Workflows</h1>
        {loaded && (
          <>
            <span className="wf-crumbs" data-testid="wf-crumbs">{feature} › <strong>{loaded.path}</strong></span>
            <button type="button" className="wf-reload" onClick={reload}>Re-read from source</button>
          </>
        )}
      </div>
      {!loaded && !error && (
        <div className="wf-empty" data-testid="wf-empty">
          <p className="hint">
            Pick a feature and a file in the Workflows list on the left to see its workflows/ layer as diagrams: every
            XState machine is read straight from the real source file each time (nothing is stored or copied), states
            are boxes, transitions are labeled arrows (with [guards]), the start dot marks the initial state and a
            double border marks a final state.
          </p>
          <p className="hint">
            Then use the tabs on the right: <strong>Narrative</strong> explains the flow in plain English,{' '}
            <strong>Context &amp; actions</strong> shows what it remembers, and <strong>Edit</strong> changes states
            and transitions. Each edit is previewed as a source diff and only written to the real file when you
            confirm. Nothing is sent to any external service.
          </p>
        </div>
      )}
      {error && <p className="status-error" data-testid="wf-error">{error}</p>}
      {loaded && (
        <div className="wf-file">
          {editError && <p className="status-error" data-testid="wf-edit-error">{editError}</p>}
          {pending && <PendingEdit pending={pending} busy={editBusy} onConfirm={confirmEdit} onCancel={cancelEdit} />}
          <LoadedFile loaded={loaded} onEdit={proposeEdit} locked={!!pending || editBusy} view={props} />
        </div>
      )}
      {file && !loaded && !error && <p className="hint">Loading {file}…</p>}
    </div>
  );
}
