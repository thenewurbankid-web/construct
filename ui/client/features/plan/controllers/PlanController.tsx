'use client';

import type { ReactNode } from 'react';
import { ProjectGateController } from '@/features/project-gate';
import { useRegisterShellTab, useShellDrawer } from '@/features/shell';
import '../components/plan.css';
import { buildImpactView } from '../domain/ImpactView';
import { buildPlanPane } from '../domain/PlanPaneView';
import { buildTicketPane } from '../domain/TicketPaneView';
import { usePlanScreen } from '../hooks/usePlanScreen';
import { PlanPage } from '../pages/PlanPage';
import { planShellTabs } from '../pages/PlanShellTabs';

function PlanScreen({ stageActions, featureDetail }: { stageActions?: ReactNode; featureDetail?: ReactNode }) {
  const drawer = useShellDrawer();
  const s = usePlanScreen(drawer.openProcesses);
  const { state } = s;
  const ticket = buildTicketPane(state, { onTicket: s.setTicket, onTogglePick: s.togglePick, onToggleAccept: s.toggleAccept, onPropose: s.propose, onAnalyse: s.analyse, ...s.noteActions });
  const plan = buildPlanPane(state, s.stale, s.canRun, s.suggestions.length, {
    onAdd: s.addStep, onAddSuggested: s.addSuggested, onMove: s.move, onRemove: s.remove, onRetag: s.retag, onArg: s.setArg, onTitle: s.setTitle, onRun: s.run, onOpenProcesses: drawer.openProcesses,
  });
  const tabs = planShellTabs(ticket, plan);
  useRegisterShellTab('browser', tabs.browser);
  useRegisterShellTab('tools', tabs.tools);
  const view = state.impact ? buildImpactView(state.impact, state.impactSeeds) : null;
  return <PlanPage contextError={state.contextError} impact={{ status: state.impactStatus, error: state.impactError, view }} stageActions={stageActions} featureDetail={featureDetail} />;
}

/** The Features screen (`/`, also `/plan`): notes, impact, plan, and the stage actions the route composes in. Nothing here
 * calls a model, and nothing runs until you press Run plan. */
export function PlanController({ stageActions, featureDetail }: { stageActions?: ReactNode; featureDetail?: ReactNode } = {}) {
  return (
    <ProjectGateController>
      <PlanScreen stageActions={stageActions} featureDetail={featureDetail} />
    </ProjectGateController>
  );
}
