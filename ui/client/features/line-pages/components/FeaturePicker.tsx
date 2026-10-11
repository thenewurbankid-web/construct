type FeaturePickerProps = {
  features: { name: string; summary: string }[];
  current: string | null;
  onChoose: (name: string) => void;
};

/** "Which feature?": the Pages screen always opens inside one feature. */
export function FeaturePicker({ features, current, onChoose }: FeaturePickerProps) {
  if (features.length === 0) return <p className="hint">This project has no features yet, so there are no pages to show.</p>;
  return (
    <ul className="lp-cards" aria-label="Features">
      {features.map((f) => (
        <li key={f.name}>
          <button
            type="button"
            className="lp-card"
            aria-pressed={current === f.name}
            onClick={() => onChoose(f.name)}
            data-testid="lp-feature"
          >
            <span className="lp-card-title">{f.name}</span>
            <span className="lp-card-text">{f.summary}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
