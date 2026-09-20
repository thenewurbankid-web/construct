import { outcomeView } from '../domain/Runs';
import type { CoverageRow, RunOutcome } from '../types';

type CoverageTableProps = {
  rows: CoverageRow[];
  selectedFile: string | null;
  generating: boolean;
  /** The latest run's outcome for a generated test file, or null when it has not run (#305). */
  outcomeOf?: (file: string) => RunOutcome | null;
  onOpen: (file: string) => void;
  onGenerate: () => void;
};

/** Every scenario the flow can take, the branch that tells it apart, and whether a test covers it. A covered
 * scenario opens its (locked) test; an uncovered one offers Generate. Last result comes from the latest run (#305). */
export function CoverageTable({ rows, selectedFile, generating, outcomeOf, onOpen, onGenerate }: CoverageTableProps) {
  return (
    <div className="ts-tablewrap">
      <table className="ts-table" data-testid="coverage-table">
        <caption className="ts-sr">Scenarios of the selected feature and the tests that cover them</caption>
        <thead>
          <tr>
            <th className="ts-col-n" scope="col">#</th>
            <th scope="col">Scenario</th>
            <th className="ts-col-branch" scope="col">Which branch</th>
            <th className="ts-col-test" scope="col">Test</th>
            <th className="ts-col-last" scope="col">Last result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid="coverage-row" data-generated={r.generated ? 'true' : 'false'} data-selected={r.file !== null && r.file === selectedFile ? 'true' : undefined}>
              <td className="ts-col-n">{r.n}</td>
              <td>
                {r.file ? (
                  <button type="button" className="ts-row-btn" data-testid="coverage-open" onClick={() => onOpen(r.file as string)} aria-label={`Open the test for ${r.title}`}>
                    <span className="ts-cell-title ts-cell-clip">{r.title}</span>
                    <span className="ts-cell-sub ts-cell-clip">{r.route}</span>
                  </button>
                ) : (
                  <>
                    <span className="ts-cell-title ts-cell-clip">{r.title}</span>
                    <span className="ts-cell-sub ts-cell-clip">{r.route}</span>
                  </>
                )}
              </td>
              <td className="ts-col-branch"><span className="ts-cell-clip" title={r.branch}>{r.branch}</span></td>
              <td className="ts-col-test">
                <span className="ts-testcell">
                  {r.generated ? <span className="ts-chip ts-chip--locked" data-testid="chip-locked">Locked</span> : <span className="ts-chip ts-chip--none" data-testid="chip-none">None</span>}
                  {r.cloned.length > 0 && <span className="ts-chip ts-chip--yours" data-testid="chip-cloned">{r.cloned.length === 1 ? 'Cloned' : `Cloned x${r.cloned.length}`}</span>}
                  {(r.staleClones?.length ?? 0) > 0 && <span className="ts-chip ts-chip--stale" data-testid="chip-clone-stale" title="A clone of this scenario was made from a flow that has since changed. Open the clone to see what changed.">Clone out of date</span>}
                  {r.outOfDate && <span className="ts-chip ts-chip--stale" title="The flow changed since this test was generated. Generate again to refresh it.">Out of date</span>}
                  {!r.generated && <button type="button" className="ts-btn" data-testid="coverage-generate" disabled={generating} onClick={onGenerate} title="Generates every missing test for this feature">{generating ? 'Generating...' : 'Generate'}</button>}
                </span>
              </td>
              <td className="ts-col-last"><LastResult outcome={r.file && outcomeOf ? outcomeOf(r.file) : null} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The last result of one scenario's generated test: a symbol AND a word, or "Not run" when nothing has run it. */
function LastResult({ outcome }: { outcome: RunOutcome | null }) {
  if (!outcome) return <span className="ts-cell-sub" data-testid="last-result" data-status="none">Not run</span>;
  const v = outcomeView(outcome.status);
  return <span className={`ts-result-mark ts-result--${v.tone}`} data-testid="last-result" data-status={outcome.status}><span aria-hidden="true">{v.symbol} </span>{v.word}</span>;
}
