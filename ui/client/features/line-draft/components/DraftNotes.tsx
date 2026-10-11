import type { DraftControls } from '../types';

/** A refusal or a problem, as an alert; nothing when there is nothing to say. */
export function DraftError({ sentence }: { sentence: string | null }) {
  if (!sentence) return null;
  return (
    <p className="ldr-error" role="alert" data-testid="draft-error">
      {sentence}
    </p>
  );
}

/** "Add the rest" once the first steps of a longer route ran. */
function AddRest({ draft }: { draft: DraftControls }) {
  if (!draft.pending) return null;
  return (
    <button type="button" className="ldr-btn" onClick={draft.addRest} disabled={draft.busy}>
      Add the rest
    </button>
  );
}

/** What adding a route did ("Added one step to the plan; approve it to run."). */
export function DraftNotice({ draft }: { draft: DraftControls }) {
  if (!draft.notice) return null;
  return (
    <p className="ldr-notice" role="status" data-testid="draft-notice">
      {draft.notice} <AddRest draft={draft} />
    </p>
  );
}

const note = (s: string) => (
  <p key={s} className="ldr-note">
    {s}
  </p>
);

/** When Line hands over (a model or you) and the layers no route can change yet. */
export function DraftNotes({ draft }: { draft: DraftControls }) {
  const lines = draft.defer ? [draft.defer, ...draft.dropped] : draft.dropped;
  return <div data-testid="draft-notes">{lines.map(note)}</div>;
}
