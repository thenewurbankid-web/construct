import { GlassPanel, Select } from '@/components/ui';

type WorkflowsBrowserProps = {
  feature: string;
  onFeatureChange: (feature: string) => void;
  features: string[];
  file: string;
  onOpen: (file: string) => void;
  files: string[];
  loading: boolean;
};

// Feature picker + the selected feature's workflows/ files. Presentation-only.
export function WorkflowsBrowser({ feature, onFeatureChange, features, file, onOpen, files, loading }: WorkflowsBrowserProps) {
  return (
    <GlassPanel className="pages-browser wf-browser">
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
          <h4>workflows/ in &quot;{feature}&quot;</h4>
          {loading ? (
            <p className="hint">Loading…</p>
          ) : files.length === 0 ? (
            <p className="hint">No files under features/{feature}/workflows/.</p>
          ) : (
            <ul className="pages-file-list">
              {files.map((f) => (
                <li key={f} className={f === file ? 'active' : ''}>
                  <button type="button" onClick={() => onOpen(f)}>{f}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
