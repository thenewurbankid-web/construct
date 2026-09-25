import type { OpenQuestionsProps } from '../types';
import { OpenQuestion } from './OpenQuestion';

/** The open questions: a word the rules do not know, or a placement they cannot decide, each a closed set of buttons. Never a guess. */
export function OpenQuestions({ open, busy, onAnswer }: OpenQuestionsProps) {
  return (
    <section className="rq-card rq-card--open" aria-labelledby="rq-open-h" data-testid="requirement-open">
      <h2 className="rq-h2" id="rq-open-h">Open questions ({open.length})</h2>
      <p className="rq-muted">The rules do not guess. Pick one option for each; the read-back redraws from your answer.</p>
      {open.map((q) => <OpenQuestion key={q.id} q={q} busy={busy} onAnswer={onAnswer} />)}
    </section>
  );
}
