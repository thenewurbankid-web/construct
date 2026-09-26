export type TopBarProps = {
  name: string;
  status: string;
  onRename: (name: string) => void;
  onExport: () => void;
  onSave: () => void;
  onLoad: () => void;
};

/** The page name and the three actions on a layout: Export TSX, Save and Load (this browser only). */
export function TopBar({ name, status, onRename, onExport, onSave, onLoad }: TopBarProps) {
  return (
    <div className="pb-topbar">
      <h1 className="pb-h1">Page Builder</h1>
      <label className="pb-name" htmlFor="pb-name">
        <span className="pb-field-label">Page name</span>
        <input id="pb-name" className="pb-input" data-testid="pb-name" value={name} onChange={(e) => onRename(e.target.value)} />
      </label>
      <span className="pb-status" role="status" data-testid="pb-status">
        {status}
      </span>
      <span className="pb-gap" />
      <button type="button" className="pb-btn" data-testid="pb-load" onClick={onLoad}>
        Load
      </button>
      <button type="button" className="pb-btn" data-testid="pb-save" onClick={onSave}>
        Save
      </button>
      <button type="button" className="pb-btn pb-btn--primary" data-testid="pb-export" onClick={onExport}>
        Export TSX
      </button>
    </div>
  );
}
