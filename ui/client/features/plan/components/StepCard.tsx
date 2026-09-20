import type { StepCardProps } from '../types';
import { StepArgs } from './StepArgs';

const tagClass = { deterministic: 'det', 'local-model': 'model', user: 'user' } as const;

/** One step: its tag, what it touches, the exact command it will run, and its arguments, editable. Errors from
 * the validator sit right under the step they are about, in plain words. */
export function StepCard({ view: v, index, count, onMove, onRemove, onRetag, onArg, onTitle }: StepCardProps) {
  const n = index + 1;
  return (
    <li className={`pl-step${v.errors.length ? ' pl-step--bad' : ''}`} data-testid="plan-step" data-step-id={v.id} data-flow={v.flow}>
      <div className="pl-step-head">
        <span className="pl-step-n" data-testid="plan-step-n">{n}</span>
        <input className="pl-step-title" value={v.title} onChange={(e) => onTitle(e.target.value)} aria-label={`Title of step ${n}`} />
        <span className={`pl-badge pl-badge--${tagClass[v.executor]}`} data-testid="plan-step-tag">{v.executorLabel}</span>
        <button type="button" className="pl-iconbtn" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move step ${n} up`} data-testid="plan-step-up">Up</button>
        <button type="button" className="pl-iconbtn" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move step ${n} down`} data-testid="plan-step-down">Down</button>
        <button type="button" className="pl-iconbtn" onClick={onRemove} aria-label={`Remove step ${n}`} data-testid="plan-step-remove">Remove</button>
      </div>
      <div className="pl-tags" role="group" aria-label={`Who runs step ${n}`}>
        {v.tags.map((t) => (
          <button key={t.id} type="button" aria-pressed={t.pressed} title={t.hint} onClick={() => onRetag(t.id)} data-testid={`plan-tag-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      <StepArgs args={v.args} onArg={onArg} />
      {v.hasObjectArg && <p className="pl-hint">This flow takes a structured argument that is edited in the CLI, not here.</p>}
      {v.touches && <p className="pl-hint" data-testid="plan-step-touches">Touches: {v.touches}</p>}
      {v.model && <p className="pl-hint" data-testid="plan-step-model">A local model writes part of this result. You approve it before it reaches your project.</p>}
      {v.command && <pre className="pl-cmd pl-mono" data-testid="plan-step-command">{v.command}</pre>}
      {v.manual && <p className="pl-hint" data-testid="plan-step-command">Nothing to run: the process pauses here and waits for you.</p>}
      {v.errors.length > 0 && (
        <ul className="pl-errs" role="alert" data-testid="plan-step-errors">
          {v.errors.map((e) => (
            <li key={e.key} className="pl-err" data-code={e.code}><strong>{e.lead}.</strong> {e.plain}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
