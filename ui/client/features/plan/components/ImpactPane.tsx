import type { ImpactPaneProps } from '../types';
import { ImpactTable } from './ImpactTable';
import { ProvenanceBadge } from './ProvenanceBadge';

/** Middle pane: the impact report, every row tagged Computed or Guess. Deterministic; no model is involved
 * and the screen says so. Empty, loading and error are designed states, each with a next action. */
export function ImpactPane({ status, error, view }: ImpactPaneProps) {
  if (status === 'idle') {
    return (
      <div className="dg-empty" data-testid="plan-impact-empty">
        <p className="dg-empty-title">No impact yet</p>
        <p className="hint">Write a note on the left, pick the units it is about (or let Construct suggest some and confirm them), then choose Check impact.</p>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <p className="pl-lede" role="status" data-testid="plan-impact-loading">
        Checking: reading your project&apos;s imports and layers. Deterministic, no model.
      </p>
    );
  }
  if (status === 'failed' || !view) {
    return (
      <div className="dg-empty" role="alert" data-testid="plan-impact-error">
        <p className="dg-empty-title">The impact could not be computed</p>
        <p className="hint">{error}</p>
      </div>
    );
  }
  return (
    <div data-testid="plan-impact">
      <p className="pl-summary" data-testid="plan-impact-headline">
        <strong>{view.headline}</strong> <span className="pl-det">DETERMINISTIC</span>
        <br />
        <span className="pl-hint">
          From {view.seedNote}. {view.counts}.
        </span>
      </p>
      {view.warnings.map((w) => (
        <p key={w.key} className="pl-warn" data-testid="plan-impact-warning">
          <strong>{w.title}</strong> <ProvenanceBadge p={w.provenance} />
          <br />
          {w.message}
        </p>
      ))}
      <h2 className="pl-h">Features</h2>
      <ImpactTable heads={['Feature', 'Layers', 'Why']} rows={view.features} testId="plan-impact-features" rowTestId="plan-impact-feature" />
      <h2 className="pl-h">Files</h2>
      <ImpactTable heads={['File', 'Layer', 'Why']} rows={view.files} testId="plan-impact-files" rowTestId="plan-impact-file" />
      {view.truncated && <p className="pl-hint">The list was capped; narrow the units to see the rest.</p>}
    </div>
  );
}
