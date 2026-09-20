import type { IndicatorCard } from '../types';

/** Tools pane of one change: the five indicators, each with the engine's own sentence and where it comes from. */
export function IndicatorCards({ cards }: { cards: IndicatorCard[] }) {
  return (
    <div className="rv-legend" data-testid="review-indicators">
      {cards.map((c) => (
        <section key={c.id} className={`rv-card rv-card--${c.tone}`} data-testid="review-indicator" data-indicator={c.id} data-status={c.statusLabel}>
          <header className="rv-card-head">
            <h3 className="rv-card-title">{c.title}</h3>
            <span className={`rv-badge rv-badge--${c.tone}`}>{c.statusLabel}</span>
          </header>
          <p className="rv-card-means" data-testid="review-indicator-headline">{c.headline}</p>
          {c.reason && <p className="rv-hint" data-testid="review-indicator-reason">{c.reason}</p>}
          {c.findings.length > 0 && (
            <ul className="rv-findings" aria-label={`${c.title} findings`}>
              {c.findings.map((f) => (
                <li key={f.id}><span className="rv-chip">{f.resolutionLabel}</span> {f.title}</li>
              ))}
            </ul>
          )}
          <p className="rv-hint">Where this comes from: {c.source}</p>
        </section>
      ))}
    </div>
  );
}
