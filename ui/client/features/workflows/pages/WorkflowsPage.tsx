import type { ReactNode } from 'react';
import { MachineCanvas } from '../components/MachineCanvas';
import { WorkflowDiffPreview } from '../components/WorkflowDiffPreview';
import { WorkflowsBrowser } from '../components/WorkflowsBrowser';
import type { PendingWorkflowEdit, WorkflowEditRequest, WorkflowFileMachines, WorkflowsState } from '../types';

export type WorkflowsPageProps = WorkflowsState & {
  setFeature: (feature: string) => void;
  openFile: (file: string) => void;
  reload: () => void;
  proposeEdit: (req: WorkflowEditRequest) => void;
  confirmEdit: () => void;
  cancelEdit: () => void;
};

type LoadedFileProps = { loaded: WorkflowFileMachines; onEdit: (req: WorkflowEditRequest) => void; locked: boolean };

function LoadedFile({ loaded, onEdit, locked }: LoadedFileProps): ReactNode {
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
        <MachineCanvas key={`${m.id}:${i}`} machine={m} machineIndex={i} onEdit={onEdit} locked={locked} />
      ))}
    </>
  );
}

function PendingEdit({ pending, busy, onConfirm, onCancel }: { pending: PendingWorkflowEdit; busy: boolean; onConfirm: () => void; onCancel: () => void }): ReactNode {
  return <WorkflowDiffPreview hunks={pending.hunks} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />;
}

export function WorkflowsPage(props: WorkflowsPageProps): ReactNode {
  const { features, feature, setFeature, files, filesLoading, file, openFile, reload, loaded, error } = props;
  const { pending, editBusy, editError, proposeEdit, confirmEdit, cancelEdit } = props;
  return (
    <div className="page workflows-page">
      <h1>Workflows</h1>
      <p className="hint">
        Pick a feature to see its workflows/ layer as diagrams: every XState machine is read straight from
        the real source file each time (nothing is stored or copied), states are boxes, transitions are
        labeled arrows (with [guards]), the start dot marks the initial state and a double border marks
        a final state. You can edit states and plain transitions visually; each edit is previewed as a
        source diff and only written to the real file when you confirm. Nothing is sent to any external
        service.
      </p>

      <WorkflowsBrowser
        feature={feature}
        onFeatureChange={setFeature}
        features={features}
        file={file}
        onOpen={openFile}
        files={files}
        loading={filesLoading}
      />

      {error && <p className="status-error" data-testid="wf-error">{error}</p>}

      {loaded && (
        <div className="wf-file">
          <div className="wf-file-head">
            <h2>{loaded.path}</h2>
            <button type="button" className="wf-reload" onClick={reload}>Re-read from source</button>
          </div>
          {editError && <p className="status-error" data-testid="wf-edit-error">{editError}</p>}
          {pending && <PendingEdit pending={pending} busy={editBusy} onConfirm={confirmEdit} onCancel={cancelEdit} />}
          <LoadedFile loaded={loaded} onEdit={proposeEdit} locked={!!pending || editBusy} />
        </div>
      )}
    </div>
  );
}
