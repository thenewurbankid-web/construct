import type { FormEvent } from 'react';
import { DraftError, DraftNotes, DraftNotice } from '../components/DraftNotes';
import { DraftQuestions } from '../components/DraftQuestions';
import { DraftRoute } from '../components/DraftRoute';
import '../components/line-draft.css';
import type { DraftControls, RouteCard } from '../types';

/** The drafter box: say what you want; Line lists every way to do it, each tried by Construct on a copy of the project,
 * the recommended one first. Add to plan puts a route's steps in the Plan panel, where you approve each change. */
export function LineDraftPage({ draft }: { draft: DraftControls }) {
  if (!draft.on) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    draft.submit();
  };
  const route = (c: RouteCard) => <DraftRoute key={c.id} card={c} busy={draft.busy} onAdd={draft.add} />;
  return (
    <section className="ldr" aria-labelledby="ldr-head" data-testid="line-draft" aria-busy={draft.busy}>
      <h2 id="ldr-head" className="ldr-head">
        Describe a change <small>Line lists every way to do it; nothing changes until you approve it in the plan.</small>
      </h2>
      <form className="ldr-form" onSubmit={submit}>
        <input className="ldr-input" aria-label="What do you want to change?" placeholder="For example: add a badge to the orders feature" value={draft.request} onChange={(e) => draft.setRequest(e.target.value)} maxLength={500} />
        <button type="submit" className="ldr-btn ldr-btn--primary" disabled={draft.busy}>
          Draft
        </button>
      </form>
      <DraftError sentence={draft.error} />
      <DraftNotice draft={draft} />
      <DraftQuestions questions={draft.questions} busy={draft.busy} onAnswer={draft.answer} />
      <ol className="ldr-routes" aria-label="Ways to do it">
        {draft.cards.map(route)}
      </ol>
      <DraftNotes draft={draft} />
    </section>
  );
}
