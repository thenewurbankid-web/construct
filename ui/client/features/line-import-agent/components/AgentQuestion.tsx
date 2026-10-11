import type { QuestionModel } from '../types';

type AgentQuestionProps = { question: QuestionModel | null; busy: boolean; onAnswer: (questionId: string, optionId: string) => void };

/** The one question the agent asks when its checks cannot decide: one click per answer, the recommended one first. */
export function AgentQuestion({ question, busy, onAnswer }: AgentQuestionProps) {
  if (!question) return null;
  const choice = (o: QuestionModel['options'][number]) => (
    <button key={o.id} type="button" className={o.recommended ? 'la-choice la-choice--rec' : 'la-choice'} disabled={busy} onClick={() => onAnswer(question.id, o.id)}>
      {o.recommended ? `${o.sentence} (recommended)` : o.sentence}
    </button>
  );
  return (
    <fieldset className="la-question" data-testid="la-question">
      <legend className="la-label">{question.sentence}</legend>
      {question.options.map(choice)}
    </fieldset>
  );
}
