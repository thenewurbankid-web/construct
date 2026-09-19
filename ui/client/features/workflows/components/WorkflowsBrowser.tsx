import { Select } from '@/components/ui';
import type { WorkflowMachine } from '../types';

type WorkflowsBrowserProps = {
  feature: string;
  onFeatureChange: (feature: string) => void;
  features: string[];
  file: string;
  onOpen: (file: string) => void;
  files: string[];
  loading: boolean;
  /** Machines of the open file, and which one the Tools tabs act on. */
  machines: WorkflowMachine[];
  machineIndex: number;
  onPickMachine: (index: number) => void;
};

// The Browser panel's "Workflows" tab: feature picker, the selected feature's
// workflows/ files and the machines inside the open file. Presentation-only.
export function WorkflowsBrowser({ feature, onFeatureChange, features, file, onOpen, files, loading, machines, machineIndex, onPickMachine }: WorkflowsBrowserProps) {
  return (
    <div className="wf-browser" data-testid="wf-browser">
      <label className="field">
        <span>Feature</span>
        <Select value={feature} onChange={(e) => onFeatureChange(e.target.value)}>
          <option value="">— select a feature —</option>
          {features.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </label>
      {features.length === 0 && <p className="hint">No feature in this project has a workflows/ folder yet. Try <code>construct generate workflow &lt;Name&gt; --feature &lt;feature&gt; --from graph.json</code>.</p>}
      {feature && (
        <div>
          <h4 className="wf-list-title">workflows/ in &quot;{feature}&quot;</h4>
          {loading ? (
            <p className="hint">Loading…</p>
          ) : files.length === 0 ? (
            <p className="hint">No files under features/{feature}/workflows/.</p>
          ) : (
            <ul className="wf-file-list">
              {files.map((f) => (
                <li key={f} className={f === file ? 'active' : ''}>
                  <button type="button" aria-current={f === file ? 'true' : undefined} onClick={() => onOpen(f)}>{f}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {machines.length > 0 && (
        <div data-testid="wf-machine-list">
          <h4 className="wf-list-title">Machines in this file</h4>
          <ul className="wf-file-list">
            {machines.map((m, i) => (
              <li key={`${m.id}:${i}`} className={i === machineIndex ? 'active' : ''}>
                <button type="button" aria-current={i === machineIndex ? 'true' : undefined} data-testid={`wf-pick-machine-${i}`} onClick={() => onPickMachine(i)}>
                  <span className="wf-machine-kind">machine</span> {m.exportName ?? m.id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
