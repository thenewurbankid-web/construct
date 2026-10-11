import { AgentPlan } from '../components/AgentPlan';
import { AgentRecord } from '../components/AgentRecord';
import { AgentStart } from '../components/AgentStart';
import { LogicPanel } from '../components/LogicPanel';
import { StageBar } from '../components/StageBar';
import { VerifyList } from '../components/VerifyList';
import { WaitingPanel } from '../components/WaitingPanel';
import type { AgentControls } from '../types';

/** /import/agent: one agent brings one folder into Line as a fixed process: read, map the logic, pin it with tests, sort,
 * plan, your review, the changes (each one you approve, each checked: nothing lost, tests pass), the checks, done. It can be paused and resumed; every change to the plan is recorded. */
export function LineImportAgentPage({ controls }: { controls: AgentControls }) {
  const { state, screen, actions } = controls;
  return (
    <div className="la-page" data-testid="line-import-agent">
      <header className="la-head">
        <p className="la-eyebrow">Line</p>
        <h1 className="la-h1">Import agent</h1>
        <p className="la-hint">Let the agent bring one folder of your app into Line. You review its plan and approve every change.</p>
      </header>
      <AgentStart folders={state.folders} folder={state.folder} route={state.route} busy={state.busy} started={screen.started} onFolder={actions.setFolder} onRoute={actions.setRoute} onStart={actions.start} />
      <StageBar stages={screen.stages} />
      <WaitingPanel screen={screen} busy={state.busy} error={state.error} actions={actions} />
      <LogicPanel logic={screen.logic} />
      <AgentPlan rows={screen.rows} busy={state.busy} actions={actions} />
      <VerifyList checks={screen.checks} />
      <AgentRecord screen={screen} />
    </div>
  );
}
