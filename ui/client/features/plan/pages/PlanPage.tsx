import { ImpactPane } from '../components/ImpactPane';
import type { ImpactPaneProps } from '../types';

export type PlanPageProps = {
  contextError: string | null;
  impact: ImpactPaneProps;
};

// Presentation-only: the stage of Plan mode is the impact report. The ticket and the plan sit in the panes.
export function PlanPage({ contextError, impact }: PlanPageProps) {
  return (
    <div className="pl-stage" data-testid="plan-stage">
      <h1 className="pl-h1">Plan</h1>
      <p className="pl-lede">
        From a note to a plan you can review before anything runs. The impact is worked out from your code and your rules, <span className="pl-det">DETERMINISTIC</span> and without a model; the plan shows exactly where a model would be used.
      </p>
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
