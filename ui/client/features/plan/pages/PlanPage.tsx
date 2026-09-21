import type { ReactNode } from 'react';
import { ImpactPane } from '../components/ImpactPane';
import type { ImpactPaneProps } from '../types';

export type PlanPageProps = {
  contextError: string | null;
  impact: ImpactPaneProps;
  /** The Features stage's actions (Create, Refactor, Research, Import), composed in by the route. */
  stageActions?: ReactNode;
};

// Presentation-only: the stage of the Features screen is the impact report, under the stage actions. The notes and the plan sit in the panes.
export function PlanPage({ contextError, impact, stageActions }: PlanPageProps) {
  return (
    <div className="pl-stage" data-testid="plan-stage">
      <h1 className="pl-h1">Features</h1>
      <p className="pl-lede">
        From a note to a plan you can review before anything runs. The impact is worked out from your code and your rules, <span className="pl-det">DETERMINISTIC</span> and without a model; the plan shows exactly where a model would be used.
      </p>
      {stageActions}
      {contextError && (
        <div className="dg-empty" role="alert" data-testid="plan-context-error">
          <p className="dg-empty-title">This project could not be read</p>
          <p className="hint">{contextError}</p>
        </div>
      )}
      <ImpactPane {...impact} />
    </div>
  );
}
