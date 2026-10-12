import { Details } from '@/lib/ChatEntry';
import type { MetricCard } from '@/lib/lineKnowsContract';

const ARROW = { up: 'Better', down: 'Worse', flat: 'Same', none: '' } as const;

/** One number: what it measures, the value, its trend, how to improve it, and the items behind it. */
export function MetricCardView({ card, onShow }: { card: MetricCard; onShow: (id: string) => void }) {
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
      {card.itemRows.length ? (
        <ul className="lks-items" aria-label={`Behind ${card.label}`}>
          {card.itemRows.slice(0, 6).map((row) => (
            <li key={row.id}>
              <button type="button" className="ln-btn ln-btn--sm ln-btn--ghost" data-testid="knows-metric-item" data-item={row.id} onClick={() => onShow(row.id)}>
                Show {row.label} on the Map
              </button>
              {row.secondary ? (
                <span className="lks-item-id" data-testid="knows-metric-item-id">
                  {row.secondary}
                </span>
              ) : null}
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
