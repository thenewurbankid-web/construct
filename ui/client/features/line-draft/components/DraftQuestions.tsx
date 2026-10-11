import type { DraftQuestion } from '../types';

type Answer = { busy: boolean; onAnswer: (word: string, key: string) => void };

/** One closed choice; the suggested one reads "Yes, ...". */
function Choice({ q, choice, busy, onAnswer }: Answer & { q: DraftQuestion; choice: { key: string; label: string } }) {
  const suggested = choice.key === q.suggested;
  return (
    <button type="button" className={suggested ? 'ldr-btn ldr-btn--primary' : 'ldr-btn'} onClick={() => onAnswer(q.word, choice.key)} disabled={busy}>
      {suggested ? `Yes, ${choice.label}` : choice.label}
    </button>
  );
}

/** One "Did you mean ...?" with its choices. */
function Question({ q, ...answer }: Answer & { q: DraftQuestion }) {
  const choice = (c: { key: string; label: string }) => <Choice key={c.key} q={q} choice={c} {...answer} />;
  return (
    <li className="ldr-question" data-testid="draft-question">
      <p className="ldr-sentence">{q.sentence}</p>
      <span className="ldr-actions">{q.choices.map(choice)}</span>
    </li>
  );
}

/** "Did you mean ...?" for a word Line does not know: one click on a choice answers it (remembered in this project). */
export function DraftQuestions({ questions, ...answer }: Answer & { questions: DraftQuestion[] }) {
  if (!questions.length) return null;
  const question = (q: DraftQuestion) => <Question key={q.word} q={q} {...answer} />;
  return (
    <ul className="ldr-questions" aria-label="Questions about your request">
      {questions.map(question)}
    </ul>
  );
}
