import type { ImportFolders } from '../types';

type FolderPickerProps = {
  folders: ImportFolders | null;
  folder: string;
  busy: boolean;
  onFolder: (folder: string) => void;
  onScan: () => void;
};

/** Step 1: the app (the open project) and the one folder of it to bring into Line. Only that folder will be written. */
export function FolderPicker({ folders, folder, busy, onFolder, onScan }: FolderPickerProps) {
  return (
    <form
      className="li-card"
      aria-label="Pick the folder to import"
      onSubmit={(e) => {
        e.preventDefault();
        onScan();
      }}
    >
      <p className="li-source">
        App: <strong data-testid="li-source">{folders ? folders.sourceRoot : 'the open project'}</strong>
      </p>
      <label className="li-label" htmlFor="li-folder">Folder to bring into Line</label>
      <div className="li-row">
        <input
          id="li-folder"
          className="li-input"
          list="li-folders"
          value={folder}
          placeholder="src/alerts"
          autoComplete="off"
          onChange={(e) => onFolder(e.target.value)}
        />
        <datalist id="li-folders">
          {(folders?.folders ?? []).map((f) => (
            <option key={f.path} value={f.path}>{`${f.files} code files`}</option>
          ))}
        </datalist>
        <button type="submit" className="li-btn li-btn--primary" disabled={busy || !folder.trim()}>
          {busy ? 'Reading…' : 'Read folder'}
        </button>
      </div>
      <p className="li-hint">Line reads the whole app to see what uses what, but writes only inside this folder. Everything else stays as it is.</p>
    </form>
  );
}
