import type { ReactNode } from 'react';
import { MachineCanvas } from '../components/MachineCanvas';
import { WorkflowsBrowser } from '../components/WorkflowsBrowser';
import type { WorkflowFileMachines, WorkflowsState } from '../types';

export type WorkflowsPageProps = WorkflowsState & {
  setFeature: (feature: string) => void;
  openFile: (file: string) => void;
  reload: () => void;
};

function LoadedFile({ loaded }: { loaded: WorkflowFileMachines }): ReactNode {
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
        <MachineCanvas key={`${m.id}:${i}`} machine={m} />
      ))}
    </>
  );
}

export function WorkflowsPage(props: WorkflowsPageProps): ReactNode {
  const { features, feature, setFeature, files, filesLoading, file, openFile, reload, loaded, error } = props;
  return (
    <div className="page workflows-page">
      <h1>Workflows</h1>
      <p className="hint">
        Pick a feature to see its workflows/ layer as diagrams: every XState machine is read straight from
        the real source file each time (nothing is stored or copied), states are boxes, transitions are
        labeled arrows (with [guards]), the start dot marks the initial state and a double border marks
        a final state. Read-only. Nothing is sent to any external service.
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
          <LoadedFile loaded={loaded} />
        </div>
      )}
    </div>
  );
}
