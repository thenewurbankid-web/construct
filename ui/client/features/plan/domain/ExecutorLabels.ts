// Pure (DOMAIN-001): the three tags of the design (docs/design/cockpit-layout.md section 4), in one place.
import type { Executor } from './PlanTypes.ts';

export const EXECUTORS: { id: Executor; label: string; hint: string }[] = [
  { id: 'deterministic', label: 'Deterministic', hint: 'A Construct block runs it. No model is involved.' },
  { id: 'local-model', label: 'Local model', hint: 'The local model writes part of the result. You approve it before it reaches your project.' },
  { id: 'user', label: 'You', hint: 'The process pauses and waits for you to do this step.' },
];

export const executorLabel = (e: Executor): string => EXECUTORS.find((x) => x.id === e)?.label ?? e;
