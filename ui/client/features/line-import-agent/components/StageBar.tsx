import type { AgentScreen } from '../types';

const MARK: Record<string, string> = { done: 'done', current: 'now', todo: 'next' };
const ARIA: Record<string, 'step' | undefined> = { current: 'step' };

const stage = (s: AgentScreen['stages'][number]) => (
  <li key={s.id} className={`la-stage la-stage--${s.status}`} aria-current={ARIA[s.status]} data-stage={s.id}>
    {s.label}
    <span className="la-sr">{` (${MARK[s.status]})`}</span>
  </li>
);

/** The fixed process, one stage after another: what is done, where it is now, what comes next. */
export function StageBar({ stages }: { stages: AgentScreen['stages'] }) {
  if (!stages.length) return null;
  return <ol className="la-stages" aria-label="Import stages" data-testid="la-stages">{stages.map(stage)}</ol>;
}
