import { GlassPanel, Select } from '@/components/ui';

type PagesBrowserProps = {
  feature: string;
  onFeatureChange: (feature: string) => void;
  features: string[];
  file: string;
  onOpen: (file: string) => void;
  files: string[];
  loading: boolean;
  /** False in the Flow view, which shows the feature picker without the pages list. */
  showPages?: boolean;
  /** False in the Files view (#536): rendered as the content of PagesBrowserTab's shared
   * `.pages-browser` <details> section instead of its own GlassPanel card. The Flow view's call
   * site (`showPages={false}`) keeps the default, unchanged standalone-card rendering. */
  panel?: boolean;
};

// #49 — pages browser. Presentation-only.
export function PagesBrowser({ feature, onFeatureChange, features, file, onOpen, files, loading, showPages = true, panel = true }: PagesBrowserProps) {
  const content = (
    <>
      <label className="field">
        <span>Feature</span>
        <Select value={feature} onChange={(e) => onFeatureChange(e.target.value)}>
          <option value="">— select a feature —</option>
          {features.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </label>
      {feature && showPages && (
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
    </>
  );

  return panel ? <GlassPanel className="pages-browser">{content}</GlassPanel> : content;
}
