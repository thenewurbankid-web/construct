// Pure (DOMAIN-001): step ids.
import type { PlanStep } from './PlanTypes.ts';

export function nextStepId(steps: PlanStep[], counter: number): { id: string; nextId: number } {
  const used = new Set(steps.map((s) => s.id));
  let n = Math.max(counter, 1);
  while (used.has(`s${n}`)) n += 1;
  return { id: `s${n}`, nextId: n + 1 };
}
