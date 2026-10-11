import type { ReactNode } from 'react';
import { ImpactPane } from '../components/ImpactPane';
import { RequirementLink } from '../components/RequirementLink';
import type { ImpactPaneProps } from '../types';

export type PlanPageProps = {
  contextError: string | null;
  impact: ImpactPaneProps;
  /** The Features stage's actions (Create, Refactor, Research, Import), composed in by the route. */
  stageActions?: ReactNode;
  /** The chosen feature's details (Features screen, #431), composed in by the route beside the actions. */
  featureDetail?: ReactNode;
  /** cd1: a Line project's stage (the Features chat), shown in place of the heading, actions and impact. */
  stage?: ReactNode;
};

// Presentation-only: the stage of the Features screen is the impact report, under the stage actions. The notes and the plan sit in the panes.
export function PlanPage({ contextError, impact, stageActions, featureDetail, stage }: PlanPageProps) {
  if (stage) {
    return (
      <div className="pl-stage pl-stage--line" data-testid="plan-stage">
        {stage}
      </div>
    );
  }
  return (
    <div className="pl-stage" data-testid="plan-stage">
      <h1 className="pl-h1">Features</h1>
      <p className="pl-lede">
        Describe a change in a note: Construct works out what it touches from your code and your rules, without an AI model, and turns it into a plan you review before anything runs.
      </p>
      <RequirementLink />
      {stageActions}
      {featureDetail}
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
