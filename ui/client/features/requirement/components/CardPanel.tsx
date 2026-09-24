import type { CardPanelProps } from '../types';

/** Step 2: what was understood. Nouns and verbs carry a kind badge; every check names the word that caused it. Presentation only. */
export function CardPanel({ card }: CardPanelProps) {
  return (
    <section className="rq-card" aria-labelledby="rq-card-h" data-testid="requirement-card">
      <h2 className="rq-h2" id="rq-card-h">2. What was understood</h2>
      <p className="rq-muted" data-testid="requirement-counts">{card.counts}</p>
      <div className="rq-cols">
        <div>
          <h3 className="rq-h3">Nouns</h3>
          <ul className="rq-list" data-testid="requirement-nouns">
            {card.nouns.map((n) => (
              <li key={n.id} className="rq-item" data-testid="requirement-noun">
                <span className={`rq-badge rq-badge--${n.kind}`}>{n.kindLabel}</span>
                <span>{n.text}</span>
                {n.properties && <span className="rq-muted">({n.properties})</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="rq-h3">Verbs</h3>
          <ul className="rq-list" data-testid="requirement-verbs">
            {card.verbs.map((v) => (
              <li key={v.id} className="rq-item" data-testid="requirement-verb">
                <span className={`rq-badge rq-badge--${v.kind}`}>{v.kindLabel}</span>
                <span>{v.text}</span>
                {v.acts && <span className="rq-muted">on {v.acts}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <h3 className="rq-h3">Checks</h3>
      <ul className="rq-list" data-testid="requirement-checks">
        {card.checks.map((c) => (
          <li key={c.id} className="rq-item rq-item--wrap" data-testid="requirement-check">
            <span className="rq-badge rq-badge--check">{c.name}</span>
            <span>from &ldquo;{c.from}&rdquo;</span>
            <span className="rq-muted">{c.why}</span>
          </li>
        ))}
        {card.checks.length === 0 && <li className="rq-muted">No business words asked for a check.</li>}
      </ul>
    </section>
  );
}
