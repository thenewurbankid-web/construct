import type { RouteCardView, TriedView } from '../types';

/** What the person can do with a draft's route card (absent on a stored case). */
export type RouteEdit = { onValid: (id: string) => void; onStar: (id: string) => void; onTry: (id: string) => void };

const item = (text: string, i: number) => <li key={`${i}-${text}`}>{text}</li>;
const check = (c: { text: string; ok: boolean }, i: number) => (
  <li key={`${i}-${c.text}`} className="ltr-check" data-ok={String(c.ok)}>
    {c.text}
  </li>
);

/** What a Try it run showed: its sentence, then each check passing or failing. */
function Tried({ tried }: { tried: TriedView | null }) {
  if (!tried) return null;
  return (
    <div data-testid="train-try" data-ok={String(tried.ok)}>
      <p className="ltr-result" data-ok={String(tried.ok)}>{tried.sentence}</p>
      <ul className="ltr-list" aria-label="Checks in the scratch copy">
        {tried.checks.map(check)}
      </ul>
    </div>
  );
}

/** Valid (a checkbox), Preferred (a star) and Try it, for a draft's route. */
function EditControls({ card, edit }: { card: RouteCardView; edit?: RouteEdit }) {
  if (!edit) return null;
  return (
    <div className="ltr-actions">
      <label className="ltr-inline">
        <input type="checkbox" checked={card.valid} onChange={() => edit.onValid(card.id)} />
        Valid
      </label>
      <button type="button" className="ltr-btn" aria-pressed={card.starred} onClick={() => edit.onStar(card.id)}>
        {card.starLabel}
      </button>
      <button type="button" className="ltr-btn" onClick={() => edit.onTry(card.id)}>
        Try it
      </button>
    </div>
  );
}

/** What Line asks first, for a route that asks. */
function Asks({ sentence }: { sentence?: string }) {
  if (!sentence) return null;
  return <p className="ltr-touches">Line asks: {sentence}</p>;
}

/** One route as a card: what it is, what it touches, how many steps, the steps and checks as sentences; the tool
 * calls under a collapsed Details. */
export function RouteCard({ card, edit }: { card: RouteCardView; edit?: RouteEdit }) {
  return (
    <article className="ltr-route" data-testid="train-route" data-valid={String(card.valid)} data-preferred={String(card.starred)} aria-label={`Route: ${card.label}`}>
      <div className="ltr-route-head">
        <h4>{card.label}</h4>
        <span className="ltr-chip">{card.steps_n}</span>
        <span className="ltr-chip">{card.chip}</span>
      </div>
      <p className="ltr-touches">{card.touches}</p>
      <ol className="ltr-list" aria-label="Steps">
        {card.stepLines.map(item)}
      </ol>
      <Asks sentence={card.sentence} />
      <ul className="ltr-list" aria-label="Checks">
        {card.checks.map(item)}
      </ul>
      <EditControls card={card} edit={edit} />
      <Tried tried={card.tried} />
      <details className="ltr-tech">
        <summary>Details</summary>
        <pre data-testid="train-route-calls">{JSON.stringify(card.steps, null, 1)}</pre>
      </details>
    </article>
  );
}
