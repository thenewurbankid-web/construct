import { GlassPanel, Select } from '@/components/ui';

type PagesBrowserProps = {
  feature: string;
  onFeatureChange: (feature: string) => void;
  features: string[];
  file: string;
  onOpen: (file: string) => void;
  files: string[];
  loading: boolean;
};

// #49 — pages browser. Presentation-only.
export function PagesBrowser({ feature, onFeatureChange, features, file, onOpen, files, loading }: PagesBrowserProps) {
  return (
    <GlassPanel className="pages-browser">
      <label className="field">
        <span>Feature</span>
        <Select value={feature} onChange={(e) => onFeatureChange(e.target.value)}>
          <option value="">— select a feature —</option>
          {features.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </label>
      {feature && (
        <div>
          <h4>pages/ in &quot;{feature}&quot;</h4>
          {loading ? (
            <p className="hint">Loading…</p>
          ) : files.length === 0 ? (
            <p className="hint">No files under features/{feature}/pages/.</p>
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
