'use client';

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { blocksShellTab, type BlockRunRequest } from '@/features/blocks';
import { envelopesShellTab } from '@/features/envelopes';
import { ProjectGateController } from '@/features/project-gate';
import { rulesShellTab } from '@/features/rules';
import { useRegisterShellTab, useShellDrawer, useShellTools } from '@/features/shell';
import { storyShellTab } from '@/features/story';
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
  // #407: the Blocks tab sits in the Browser pane beside Notes and Features. "Run this block" adds the block's example as
  // one step of THIS plan and shows the Plan tab; it starts nothing (Run plan is still the only way to run). The handler
  // is read through a ref so the tab object stays the same across renders (a new one would re-register the tab).
  const tools = useShellTools();
  const latest = useRef({ add: s.addPrefilled, show: tools.showTool });
  useEffect(() => {
    latest.current = { add: s.addPrefilled, show: tools.showTool };
  });
  const runBlock = useCallback((request: BlockRunRequest) => {
    if (latest.current.add(request)) latest.current.show('plan-plan');
  }, []);
  const blocksTab = useMemo(() => blocksShellTab(runBlock), [runBlock]);
  useRegisterShellTab('browser', blocksTab);
  // #395/#781: the Rules tab sits in the Browser pane beside Notes, Features and Blocks -- a read-only list for this
  // slice, reusing the same `/api/validate` call Diagnostics already makes.
  const rulesTab = useMemo(() => rulesShellTab(), []);
  useRegisterShellTab('browser', rulesTab);
  // #395/#771: the Envelopes tab sits in the Browser pane beside Notes, Features, Blocks and Rules -- a
  // read-only list of saved flows for this slice, reusing #759's core save/load primitive.
  const envelopesTab = useMemo(() => envelopesShellTab(drawer.openProcesses), [drawer.openProcesses]);
  useRegisterShellTab('browser', envelopesTab);
  // #387: the Story tab sits in the Browser pane beside Notes, Features, Blocks, Rules and Envelopes -- AI
  // proposes the parse pattern once (a diff you approve), later refreshes are mechanical; extraction on
  // every use is mechanically verified before it is ever shown as a diff.
  const storyTab = useMemo(() => storyShellTab(), []);
  useRegisterShellTab('browser', storyTab);
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
