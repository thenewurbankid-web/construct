import type { ImportFolders } from '../types';

type AgentStartProps = {
  folders: ImportFolders | null; folder: string; route: string; busy: boolean; started: boolean;
  onFolder: (f: string) => void; onRoute: (r: string) => void; onStart: () => void;
};

const option = (f: { path: string; files: number }) => <option key={f.path} value={f.path}>{`${f.files} code files`}</option>;

/** The folder to bring into Line, and Start. Only that folder will be written. */
export function AgentStart({ folders, folder, route, busy, started, onFolder, onRoute, onStart }: AgentStartProps) {
  const label = busy ? 'Starting…' : 'Start the import';
  return (
    <form
      className="la-card"
      aria-label="Pick the folder to import"
      onSubmit={(e) => {
        e.preventDefault();
        onStart();
      }}
    >
      <label className="la-label" htmlFor="la-folder">Folder to bring into Line</label>
      <div className="la-row">
        <input id="la-folder" className="la-input" list="la-folders" value={folder} placeholder="src/alerts" autoComplete="off" onChange={(e) => onFolder(e.target.value)} />
        <datalist id="la-folders">{(folders?.folders ?? []).map(option)}</datalist>
        <button type="submit" className="la-btn la-btn--primary" disabled={busy || !folder.trim()} hidden={started}>{label}</button>
      </div>
      <label className="la-label" htmlFor="la-route">Route (optional)</label>
      <input id="la-route" className="la-input" value={route} placeholder="/alerts" autoComplete="off" disabled={started} onChange={(e) => onRoute(e.target.value)} />
      <p className="la-hint">The agent reads the whole app (or the route you name and its sub-routes), maps every piece of logic, pins it with tests, and writes a plan for you to review. It writes only inside this folder, only the steps you approve, and stops if a step loses any logic.</p>
    </form>
  );
}
