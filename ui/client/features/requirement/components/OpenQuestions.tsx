import type { OpenQuestionsProps } from '../types';

/** The open questions: a word the rules do not know, or a placement they cannot decide, each a closed set of buttons. Never a guess. */
export function OpenQuestions({ open, busy, onAnswer }: OpenQuestionsProps) {
  return (
    <section className="rq-card rq-card--open" aria-labelledby="rq-open-h" data-testid="requirement-open">
      <h2 className="rq-h2" id="rq-open-h">Open questions ({open.length})</h2>
      <p className="rq-muted">The rules do not guess. Pick one option for each; the read-back redraws from your answer.</p>
      {open.map((q) => (
        <div key={q.id} className="rq-question" role="group" aria-label={q.question} data-testid="requirement-question">
          <p className="rq-q">{q.question}</p>
          <div className="rq-row">
            {q.options.map((o) => (
              <button key={o.id} type="button" className="rq-chip" disabled={busy} title={o.why} data-testid={`requirement-answer-${o.id}`} onClick={() => onAnswer(q, o.id)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
