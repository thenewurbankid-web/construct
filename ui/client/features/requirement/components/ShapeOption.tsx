import type { ShapeOptionProps } from '../types';

/** One option of the screen-shape offer: its button, "suggested by <provider>" when the decision provider suggests it (#633), and what it gives. */
export function ShapeOption({ offer, option, busy, onAnswer }: ShapeOptionProps) {
  return (
    <li className="rq-shape-option" data-testid="requirement-shape-option" data-option={option.id}>
      <div className="rq-row">
        <button type="button" className={`rq-chip${option.chosen ? ' rq-chip--on' : ''}`} aria-pressed={option.chosen} disabled={busy} data-testid={`requirement-shape-${option.id}`} onClick={() => onAnswer(offer, option.id)}>
          {option.label}
        </button>
        {option.suggested && offer.suggestion && <span className="rq-badge rq-badge--presentational" data-testid="requirement-shape-suggested">{offer.suggestion.label}</span>}
      </div>
      <p className="rq-muted">{option.gives}</p>
    </li>
  );
}
