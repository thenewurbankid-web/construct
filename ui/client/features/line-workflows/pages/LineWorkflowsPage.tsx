import type { ReactNode } from 'react';
import { LoadingState } from '@/features/states';
import { LibraryWorkflows } from '../components/LibraryWorkflows';
import { NotMachines } from '../components/NotMachines';
import { WorkflowDetail } from '../components/WorkflowDetail';
import { WorkflowList } from '../components/WorkflowList';
import { WorkflowNotice } from '../components/WorkflowNotice';
import '../components/line-workflows.css';
import type { LineWorkflowsView } from '../types';

/** A feature's Workflows tab: its workflows (state machines between its pages), the chosen one with its pages, state
 * diagram and When -> Do cards, the library's workflows to start from, and the Plan panel where each change waits for
 * the person's approval. */
export function LineWorkflowsPage({ view, panel }: { view: LineWorkflowsView; panel: ReactNode }) {
  const { feature, state, cards, chosen, choose, notice, busy } = view;
  if (state.phase === 'loading') return <LoadingState size="inline" label={`Reading the workflows of ${feature}`} />;
  if (state.phase === 'error') return <p className="lw-error" role="alert">{state.sentence}</p>;
  return (
    <div className="lw" data-testid="line-workflows">
      <p className="hint">A workflow moves a person between this feature&apos;s pages. Each one starts from a library workflow; you choose which pages fill it and add only what {feature} needs.</p>
      <WorkflowNotice notice={notice} />
      <div className="lw-layout">
        <div className="lw-main">
          <section aria-labelledby="lw-mine">
            <h3 id="lw-mine">Workflows in {feature}</h3>
            <WorkflowList feature={feature} cards={cards} current={chosen?.id ?? null} onChoose={choose} />
          </section>
          <WorkflowDetail
            workflow={chosen}
            diagram={view.diagram}
            pages={state.list.pages}
            newDraft={view.newDraft}
            checkDraft={view.checkDraft}
            busy={busy}
            onRole={view.setRole}
            onAdd={view.addWhenDo}
            onRemove={view.remove}
            onPromote={view.promote}
          />
          <section aria-labelledby="lw-lib">
            <h3 id="lw-lib">Start from the library</h3>
            <LibraryWorkflows feature={feature} library={view.library} busy={busy} onStart={view.startFrom} />
          </section>
          <NotMachines items={state.list.notMachines} />
        </div>
        <aside className="lw-side">{panel}</aside>
      </div>
    </div>
  );
}
