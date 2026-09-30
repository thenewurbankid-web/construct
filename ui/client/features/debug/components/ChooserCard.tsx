import { Button } from '@/components/ui';
import type { ChooserCardProps } from '../types';
import type { StepId } from '../domain/DebugTypes';

const TITLES: Record<StepId, string> = {
  'debug.reproduce': '1. Reproduce',
  'debug.isolate': '2. Isolate',
  'debug.fix': '3. Fix',
  'debug.verify': '4. Verify',
};

/** The short name a chooser id ends in, used for stable data-testids (debug-step-reproduce, debug-answer-fix-rename, ...). */
export const shortName = (id: StepId): string => id.split('.')[1];

/** One closed question of the debug chain: its options, each with why it is or isn't on offer, and its exit. Every
 * option and the exit is one button; picking one answers the chooser (the parent re-reads and moves on). debug.fix's
 * exit is rendered exactly like every other option (LIN-82 decision a: no new exit-kind UI affordance), just with
 * the label its `kind: 'ai'` action carries ("Fill with AI (reviewable diff)"). */
export function ChooserCard({ step, onAnswer }: ChooserCardProps) {
  const short = shortName(step.id);
  return (
    <section className="dbg-card" aria-labelledby={`dbg-h-${short}`} data-testid={`debug-step-${short}`} data-answered={step.answered}>
      <h2 className="dbg-h2" id={`dbg-h-${short}`}>{TITLES[step.id]}</h2>
      <p className="dbg-question" data-testid="debug-question">{step.summary.question}</p>
      <ul className="dbg-options" data-testid="debug-options">
        {step.summary.options.map((o) => (
          <li key={o.id} className="dbg-option">
            <Button
              type="button"
              variant={step.summary.chosen === o.id ? 'primary' : 'ghost'}
              disabled={!o.enabled || step.answered}
              title={o.enabled ? undefined : o.why}
              onClick={() => onAnswer(step.id, o.id)}
              data-testid={`debug-answer-${short}-${o.id}`}
            >
              {o.label}
            </Button>
            {o.enabled && o.why && <span className="dbg-why">{o.why}</span>}
          </li>
        ))}
        <li className="dbg-option dbg-option--exit">
          <Button
            type="button"
            variant={step.summary.chosen === null && step.answered ? 'primary' : 'ghost'}
            disabled={step.answered}
            onClick={() => onAnswer(step.id, 'exit')}
            data-testid={`debug-answer-${short}-exit`}
          >
            {step.exit.label}
          </Button>
        </li>
      </ul>
    </section>
  );
}
