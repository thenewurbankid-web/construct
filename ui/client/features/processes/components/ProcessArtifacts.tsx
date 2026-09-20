import type { ArtifactRow, DiffResult } from '../types';

type Props = {
  rows: ArtifactRow[];
  diffs: Record<string, DiffResult>;
  processId: string;
  onShowDiff: (path: string) => void;
};

/** Files the process changed. Read-only: path, short hash, and the diff on request. Nothing here
 * applies or approves a file; each one says it is awaiting approval, and that is a later gate. */
export function ProcessArtifacts({ rows, diffs, processId, onShowDiff }: Props) {
  if (rows.length === 0) return null;
  return (
    <section className="pr-artifacts" aria-label="Changed files" data-testid="process-artifacts">
      <h3 className="pr-h">Files this process changed</h3>
      <ul className="pr-art-list">
        {rows.map((row) => {
          const diff = diffs[`${processId}\n${row.path}`];
          return (
            <li key={row.path} className="pr-art" data-testid="process-artifact">
              <span className="pr-art-change">{row.change}</span>
              <code className="pr-art-path">{row.path}</code>
              <code className="pr-art-hash" title="sha256 of the new content">{row.hash}</code>
              <span className="pr-art-approval">{row.approval}</span>
              <button type="button" className="dg-btn" onClick={() => onShowDiff(row.path)} disabled={diff?.status === 'loading'}>
                {diff ? 'Reload diff' : 'Show diff'}
              </button>
              {diff?.status === 'ready' && (
                diff.diff
                  ? <pre className="pr-diff" data-testid="process-diff">{diff.diff}</pre>
                  : <p className="hint pr-diff-none">{diff.reason ?? 'No diff to show.'}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
