import { Button } from '@/components/ui';
import type { PathExpectation, ProjectTree, ProjectTreeEntry } from '../types';

type Crumb = { name: string; path: string };

type ProjectPathPickerProps = {
  tree: ProjectTree | null;
  crumbs: Crumb[];
  expects: PathExpectation;
  loading: boolean;
  error: string;
  canChooseEntry: (entry: ProjectTreeEntry) => boolean;
  hintFor: (entry: ProjectTreeEntry) => string;
  onOpen: (path: string) => void;
  onChoose: (path: string) => void;
  onClose: () => void;
  /** Replaces the default hint (the Cockpit's workspace-folder picker says what the folder is for). */
  hint?: string;
  /** The section's accessible name; defaults to "Pick from your project". */
  label?: string;
};

export function ProjectPathPicker({ tree, crumbs, expects, loading, error, canChooseEntry, hintFor, onOpen, onChoose, onClose, hint, label = 'Pick from your project' }: ProjectPathPickerProps) {
  return (
    <section className="project-picker" aria-label={label} data-testid="project-picker">
      <header className="project-picker__head">
        <nav aria-label="Location" className="project-picker__crumbs">
          <button type="button" className="project-picker__crumb" onClick={() => onOpen('')}>project</button>
          {crumbs.map((c) => (
            <span key={c.path}>
              {' / '}
              <button type="button" className="project-picker__crumb" onClick={() => onOpen(c.path)}>{c.name}</button>
            </span>
          ))}
        </nav>
        <Button type="button" onClick={onClose}>Close</Button>
      </header>
      <p className="hint">
        {hint ?? (expects === 'route' ? 'Pick a route folder (it has a page file) or a page/controller file.' : 'Pick the folder that holds your app routes.')} Only your open project is shown.
      </p>
      {error && <p role="alert" className="project-picker__error">{error}</p>}
      {loading && <p className="hint">Loading…</p>}
      {tree && !loading && (
        <ul className="project-picker__list">
          {tree.parent !== null && (
            <li><button type="button" className="project-picker__row" onClick={() => onOpen(tree.parent ?? '')}>.. (up)</button></li>
          )}
          {tree.entries.map((e) => (
            <li key={e.path} className="project-picker__item">
              {e.kind === 'dir' ? (
                <button type="button" className="project-picker__row" onClick={() => onOpen(e.path)}>
                  {e.name}/{e.route ? <span className="project-picker__tag">route</span> : null}
                </button>
              ) : (
                <span className="project-picker__row project-picker__row--file">{e.name}</span>
              )}
              {canChooseEntry(e) ? (
                <Button type="button" onClick={() => onChoose(e.path)} aria-label={`Use ${e.path}`}>Use</Button>
              ) : (
                hintFor(e) && <span className="hint">{hintFor(e)}</span>
              )}
            </li>
          ))}
          {tree.entries.length === 0 && <li className="hint">Nothing to pick in this folder.</li>}
        </ul>
      )}
      {tree && expects === 'dir' && (
        <Button type="button" onClick={() => onChoose(tree.path || '.')}>Use this folder ({tree.path || 'project root'})</Button>
      )}
    </section>
  );
}
