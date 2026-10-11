import { howItWorks, modelText } from './AiStepText.ts';
import type { AiProfiles, AiStepRow, StepProfile } from '../types';

const APPS: Record<StepProfile['source'], string> = { cockpit: 'Cockpit', trace: 'Trace', construct: 'Construct' };
const ORDER: StepProfile['source'][] = ['cockpit', 'trace', 'construct'];

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const onOff = (on: boolean): string => (on ? 'on' : 'off');

/** One row: the app and label first; step id, reply cap and ladder for Details. */
export function aiStepRow(p: StepProfile): AiStepRow {
  const l = p.ladder;
  return {
    step: p.step,
    app: APPS[p.source],
    label: p.label,
    model: modelText(p),
    how: howItWorks(p),
    details: {
      step: `Step id: ${p.step}`,
      cap: `Reply cap: ${p.maxTokens} tokens`,
      ladder: `Ladder: static (target ${pct(l.static.target)}), options and jev ${onOff(l.options.on)} (target ${pct(l.options.target)}), whole review ${onOff(l.review.on)} (target ${pct(l.review.target)})`,
      measured: `Measured: ${l.measured ?? 'not yet'}`,
      fallback: `Fallback: ${p.fallback}`,
    },
  };
}

/** Every profile as a row, Cockpit's first, then Trace's, then Construct's. */
export function aiStepRows(x: AiProfiles): AiStepRow[] {
  return ORDER.flatMap((source) => x.profiles.filter((p) => p.source === source).map(aiStepRow));
}
