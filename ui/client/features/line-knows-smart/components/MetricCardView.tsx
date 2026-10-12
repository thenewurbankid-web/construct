import { Details } from '@/lib/ChatEntry';
import type { MetricCard } from '@/lib/lineKnowsContract';

const ARROW = { up: 'Better', down: 'Worse', flat: 'Same', none: '' } as const;
const short = (id: string) => id.replace(/^[a-z]+:/, '').split('/').pop() ?? id;

/** One number: what it measures, the value, its trend, how to improve it, and the items behind it. */
export function MetricCardView({ card, onShow }: { card: MetricCard; onShow: (id: string) => void }) {
  const mapItems = card.open === 'map' ? card.items.filter((i) => /^(item|unit|feature):/.test(i)) : [];
  return (
    <li className="ln-card lks-card" data-testid="knows-metric" data-metric={card.id}>
      <h4 className="lks-label">{card.label}</h4>
      <p className="lks-value" data-testid="knows-metric-value">{card.display}</p>
      {card.empty ? <p className="lks-empty" data-testid="knows-metric-empty">{card.empty}</p> : null}
      <p className="lks-trend" data-direction={card.trendDirection} data-testid="knows-metric-trend">
        Trend: {card.trend}
        {ARROW[card.trendDirection] ? ` (${ARROW[card.trendDirection]})` : ''}
      </p>
      <p className="lks-improve" data-testid="knows-metric-improve">How to improve it: {card.improve}</p>
      {mapItems.length ? (
        <ul className="lks-items" aria-label={`Behind ${card.label}`}>
          {mapItems.slice(0, 6).map((id) => (
            <li key={id}>
              <button type="button" className="ln-btn ln-btn--sm ln-btn--ghost" data-testid="knows-metric-item" onClick={() => onShow(id)}>
                Show {short(id)} on the Map
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {card.open === 'plan' && card.items.length ? (
        <a className="ln-btn ln-btn--sm ln-btn--ghost" href="/plan" data-testid="knows-metric-plan">
          Open the plan ({card.items.length})
        </a>
      ) : null}
      <Details lines={[...card.details, ...(card.items.length ? [`behind it: ${card.items.join(', ')}`] : [])]} />
    </li>
  );
}
