import type { LibraryCard } from '../types';

type LibraryWorkflowsProps = { feature: string; library: LibraryCard[]; busy: boolean; onStart: (libraryId: string, name: string) => void };

const line = (text: string) => <li key={text}>{text}</li>;

/** The library's workflows, each complete and usable: what it does, and one button that starts a copy of it in this
 * feature (a plan step, named for the feature; the person approves it in the Plan panel). */
export function LibraryWorkflows({ feature, library, busy, onStart }: LibraryWorkflowsProps) {
  if (!library.length) return <p className="hint">The library has no workflows yet.</p>;
  const card = (w: LibraryCard) => (
    <li key={w.id} className="lw-lib" data-testid="lw-library" data-workflow={w.name}>
      <div className="lw-lib-head">
        <span className="lw-lib-name">{w.name}</span>
        <button type="button" className="lw-btn" disabled={busy} onClick={() => onStart(w.id, w.suggested)} aria-label={`Use ${w.name} in ${feature}`}>
          Use in {feature}
        </button>
      </div>
      <p className="lw-muted">{w.summary}</p>
      <details className="lw-details">
        <summary>What it does</summary>
        <ul className="lw-lines">{w.lines.map(line)}</ul>
        <p className="lw-muted">It will be created as {w.suggested}.</p>
      </details>
    </li>
  );
  return (
    <ul className="lw-library" aria-label="Library workflows">
      {library.map(card)}
    </ul>
  );
}
