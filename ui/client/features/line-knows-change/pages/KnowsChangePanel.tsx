import { ChangeCardView } from '../components/ChangeCardView';
import '../components/knows-change.css';
import type { KnowsChangeScreen } from '../hooks/useKnowsChange';

/** The Change tab: each change Line proposes from the graph, as a plan step with its typed fix that you approve. */
export function KnowsChangePanel({ screen }: { screen: KnowsChangeScreen }) {
  if (screen.error) return <p role="alert" data-testid="knows-change-error">{screen.error}</p>;
  if (screen.sentence === null) return <p aria-busy="true">Reading the changes Line proposes.</p>;
  return (
    <div className="lkc" data-testid="knows-changes">
      <p data-testid="knows-change-lead">{screen.sentence}</p>
      <ul className="lkc-list">
        {screen.cards.map((c) => (
          <ChangeCardView key={c.id} card={c} busy={screen.busy !== null} onPlan={() => screen.plan(c.id)} onApprove={() => screen.approve(c.id)} onShow={() => screen.show(c.target)} />
        ))}
      </ul>
    </div>
  );
}
