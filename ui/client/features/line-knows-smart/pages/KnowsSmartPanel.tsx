import { MetricCardView } from '../components/MetricCardView';
import '../components/knows-smart.css';
import type { KnowsSmartScreen } from '../hooks/useKnowsSmart';

/** How smart is it: how accurate Line is on this project, from records on this computer only. */
export function KnowsSmartPanel({ screen }: { screen: KnowsSmartScreen }) {
  if (screen.error) return <p role="alert" data-testid="knows-smart-error">{screen.error}</p>;
  if (!screen.view) return <p aria-busy="true">Measuring this project.</p>;
  return (
    <div className="lks" data-testid="knows-smart">
      <p data-testid="knows-smart-sentence">{screen.view.sentence}</p>
      {screen.view.groups.map((g) => (
        <section key={g.group} className="lks-group" aria-labelledby={`lks-${g.group}`}>
          <h3 id={`lks-${g.group}`}>{g.label}</h3>
          <ul className="lks-cards">
            {g.cards.map((c) => (
              <MetricCardView key={c.id} card={c} onShow={screen.showOnMap} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
