type FootProps = { changes: number; problems: string[]; reviewing: boolean; announce: string; onReview: () => void; onDiscard: () => void };

/** What blocks a review, the Review / Discard buttons, and a polite announcement of moves for screen readers. */
export function StepEditorFoot({ changes, problems, reviewing, announce, onReview, onDiscard }: FootProps) {
  return (
    <>
      <p className="ts-sr" role="status" aria-live="polite" data-testid="editor-announce">{announce}</p>
      <div className="ts-editor-foot">
        {problems.length > 0 && <ul className="ts-problems" data-testid="editor-problems">{problems.map((m) => <li key={m}>{m}</li>)}</ul>}
        <div className="ts-actions">
          <button type="button" className="ts-btn ts-btn--primary" data-testid="editor-review" disabled={changes === 0 || problems.length > 0 || reviewing} onClick={onReview}>Review changes{changes ? ` (${changes})` : ''}</button>
          <button type="button" className="ts-btn" data-testid="editor-discard" disabled={changes === 0} onClick={onDiscard}>Discard changes</button>
          <span className="ts-doc-hint">Nothing on disk has changed yet.</span>
        </div>
      </div>
    </>
  );
}
