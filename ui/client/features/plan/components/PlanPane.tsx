import type { PlanPaneProps } from '../types';
import { CatalogueBar } from './CatalogueBar';
import { RunBar } from './RunBar';
import { StepCard } from './StepCard';

/** Right pane: the plan, ordered. Add from the catalogue, remove, reorder, re-tag, edit arguments; the server's
 * validator judges every edit, and Run is off until the whole plan is valid. */
export function PlanPane(p: PlanPaneProps) {
  return (
    <div className="pl-side" data-testid="plan-pane">
      <h3 className="pl-h">Plan · {p.count} step{p.count === 1 ? '' : 's'}</h3>
      {p.count === 0 ? (
        <p className="pl-hint" data-testid="plan-empty">
          No steps yet. Add one from the catalogue below{p.catalogue.suggestionCount ? ', or add the read-only steps the impact suggests' : ''}.
        </p>
      ) : (
        <ol className="pl-steps" aria-label="Plan steps" data-testid="plan-steps">
          {p.steps.map(({ view }, i) => (
            <StepCard
              key={view.id}
              view={view}
              index={i}
              count={p.count}
              onMove={(d) => p.onMove(view.id, d)}
              onRemove={() => p.onRemove(view.id)}
              onRetag={(e) => p.onRetag(view.id, e)}
              onArg={(name, v) => p.onArg(view.id, name, v)}
              onTitle={(t) => p.onTitle(view.id, t)}
            />
          ))}
        </ol>
      )}
      {p.planErrors.length > 0 && (
        <ul className="pl-errs" role="alert" data-testid="plan-errors">
          {p.planErrors.map((e) => (
            <li key={e.key} className="pl-err" data-code={e.code}>{e.plain}</li>
          ))}
        </ul>
      )}
      <CatalogueBar {...p.catalogue} />
      <RunBar {...p.run} />
    </div>
  );
}
