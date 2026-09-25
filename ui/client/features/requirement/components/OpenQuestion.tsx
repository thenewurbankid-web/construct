import type { OpenQuestionProps } from '../types';

/**
 * One open question as closed buttons. The decision provider may suggest one option ("suggested by rules", with its reason):
 * that option is marked, never chosen; taking it is one click and choosing another is one click (#633).
 */
export function OpenQuestion({ q, busy, onAnswer }: OpenQuestionProps) {
  const suggestion = q.suggestion;
  return (
    <div className="rq-question" role="group" aria-label={q.question} data-testid="requirement-question" data-suggested={suggestion?.option ?? ''}>
      <p className="rq-q">{q.question}</p>
      <div className="rq-row">
        {q.options.map((o) => (
          <span key={o.id} className="rq-opt" data-option={o.id}>
            <button type="button" className={`rq-chip${o.suggested ? ' rq-chip--suggested' : ''}`} disabled={busy} title={o.why} data-testid={`requirement-answer-${o.id}`} onClick={() => onAnswer(q, o.id)}>
              {o.label}
            </button>
            {o.suggested && suggestion && <span className="rq-badge rq-badge--presentational" data-testid="requirement-suggested">{suggestion.label}</span>}
          </span>
        ))}
      </div>
      {suggestion?.reason && <p className="rq-muted" data-testid="requirement-suggestion-reason">Why: {suggestion.reason}</p>}
    </div>
  );
}
