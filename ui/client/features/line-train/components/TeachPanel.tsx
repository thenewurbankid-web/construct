import { RequestBox } from './RequestBox';
import { DidYouMean } from './DidYouMean';
import { SlotPicker } from './SlotPicker';
import { AddRouteForm } from './AddRouteForm';
import { RouteCard, type RouteEdit } from './RouteCard';
import type { RouteCardView, TeachControls } from '../types';

const intentOption = (i: { id: string; phrase: string }) => <option key={i.id} value={i.id}>{i.phrase}</option>;

/** One sentence after saving. */
function Saved({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="ltr-ok" data-testid="train-saved">{text}</p>;
}

/** The draft: how Line reads the request (a closed picker to correct it), the names it found, every route side by side,
 * a route to add, and Save. */
function DraftBody({ t }: { t: TeachControls }) {
  if (!t.edit) return null;
  const edit: RouteEdit = { onValid: t.toggleValid, onStar: t.star, onTry: t.tryRoute };
  const card = (c: RouteCardView) => <RouteCard key={c.id} card={c} edit={edit} />;
  return (
    <div className="ltr-draft ltr-note" data-testid="train-draft">
      <h3 data-testid="train-draft-request">{t.edit.filledRequest}</h3>
      <label className="ltr-field">
        Line reads this as
        <select className="ltr-select" value={t.edit.intent} data-testid="train-intent" onChange={(e) => t.setIntent(e.target.value)}>
          {t.intents.map(intentOption)}
        </select>
      </label>
      <SlotPicker slots={t.slots} setSlot={t.setSlot} />
      <div className="ltr-routes">{t.cards.map(card)}</div>
      <AddRouteForm tools={t.tools} fieldsFor={t.fieldsFor} addRoute={t.addRoute} />
      <span className="ltr-actions">
        <button type="button" className="ltr-btn ltr-btn--primary" onClick={t.save}>Save as a training case</button>
      </span>
      <Saved text={t.saved} />
    </div>
  );
}

/** "Teach a new request": type or pick one, read the drafter's routes, correct them, try them, save. */
export function TeachPanel({ teach }: { teach: TeachControls }) {
  return (
    <section className="ltr-section" aria-labelledby="ltr-teach-head" data-testid="train-teach">
      <h2 id="ltr-teach-head">
        Teach a new request <small>Every Try it runs in a scratch copy, never in your project.</small>
      </h2>
      <RequestBox worlds={teach.worlds} world={teach.world} chooseWorld={teach.chooseWorld} suggestions={teach.suggestions} text={teach.text} setText={teach.setText} submit={teach.submit} pick={teach.pick} />
      <DidYouMean unknown={teach.unknown} meant={teach.meant} />
      <DraftBody t={teach} />
    </section>
  );
}
