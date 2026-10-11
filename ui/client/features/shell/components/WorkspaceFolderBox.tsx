import type { ReactNode } from 'react';

type WorkspaceFolderBoxProps = {
  /** "Whole project" or the folder path. */
  folder: string;
  error?: string | null;
  /** The in-project folder picker while choosing, else null. */
  picker: ReactNode;
  onChange?: () => void;
};

function ChangeButton({ onChange }: { onChange?: () => void }) {
  if (!onChange) return null;
  return (
    <button type="button" className="ui-button ui-button--ghost" data-testid="change-workspace" onClick={onChange}>
      Change workspace folder
    </button>
  );
}

function ErrorLine({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <p className="status-error" role="alert">
      {error}
    </p>
  );
}

/** Line cu6, inside the project switcher: the project's workspace folder (the one folder Line may change) and
 * "Change workspace folder", which swaps in the in-project folder picker. */
export function WorkspaceFolderBox({ folder, error, picker, onChange }: WorkspaceFolderBoxProps) {
  return (
    <section className="sh-project-wsbox" aria-labelledby="sh-project-ws-head">
      <h2 id="sh-project-ws-head" className="sh-project-wshead">
        Workspace folder: <span data-testid="project-workspace-folder">{folder}</span>
      </h2>
      <p className="hint">Line changes only this folder. Everything else in the project is read-only and stays unchanged.</p>
      <ErrorLine error={error} />
      {picker ?? <ChangeButton onChange={onChange} />}
    </section>
  );
}

/** The workspace folder beside the project's name on the switcher button (nothing without one). */
export function WorkspaceFolderTag({ folder }: { folder?: string | null }) {
  if (!folder) return null;
  return (
    <span className="sh-project-ws" data-testid="project-workspace">
      {folder}
    </span>
  );
}
