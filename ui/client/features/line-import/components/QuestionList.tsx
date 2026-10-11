import type { QuestionView } from '../types';

type QuestionListProps = { questions: QuestionView[]; busy: boolean; onAnswer: (questionId: string, optionId: string) => void };

function Question({ q, busy, onAnswer }: { q: QuestionView } & Omit<QuestionListProps, 'questions'>) {
  return (
    <fieldset className="li-question" data-testid="li-question">
      <legend className="li-sentence">{q.sentence}</legend>
      <div className="li-row">
        {q.options.map((o) => (
          <button key={o.id} type="button" className={o.picked ? 'li-choice li-choice--on' : 'li-choice'} aria-pressed={o.picked} disabled={busy} onClick={() => onAnswer(q.id, o.id)}>
            {o.recommended ? `${o.sentence} (recommended)` : o.sentence}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The questions Line cannot decide by itself (two rules disagree): one click each, the recommended choice first. */
export function QuestionList({ questions, busy, onAnswer }: QuestionListProps) {
  return (
    <section className="li-card" aria-labelledby="li-q-h" hidden={!questions.length}>
      <h2 id="li-q-h" className="li-h2">Questions Line cannot decide</h2>
      {questions.map((q) => <Question key={q.id} q={q} busy={busy} onAnswer={onAnswer} />)}
    </section>
  );
}
