import type { FeatureCard } from '../types';

type FeatureCardListProps = { features: FeatureCard[]; current: string | null; onChoose: (name: string) => void };

/** Every feature of the project, each with "All fine" or "Needs attention" and a count in words. */
export function FeatureCardList({ features, current, onChoose }: FeatureCardListProps) {
  if (features.length === 0) return <p className="hint">This project has no features yet.</p>;
  return (
    <ul className="lf-cards" aria-label="Features">
      {features.map((f) => (
        <li key={f.name}>
          <button type="button" className="lf-card" aria-pressed={current === f.name} onClick={() => onChoose(f.name)} data-testid="lf-feature" data-feature={f.name} data-line-control="features.card" data-line-target={f.name}>
            <span className="lf-card-title">{f.name}</span>
            <span className={`lf-chip lf-chip--${f.ok ? 'ok' : 'problem'}`} data-testid="lf-feature-status">
              {f.status}
            </span>
            <span className="lf-card-text">{f.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
