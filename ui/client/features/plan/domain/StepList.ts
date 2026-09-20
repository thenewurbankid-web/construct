// Pure (DOMAIN-001): add, remove and reorder steps. Nothing here decides validity: that is the server's `validatePlan()`,
// asked after every edit. These only keep the list well-formed enough to ask (unique ids, dependsOn that never
// points at a removed step).
import type { FlowInfo, PlanStep } from './PlanTypes.ts';
import { nextStepId } from './StepIds.ts';
import { deriveTouches } from './StepTouches.ts';

export const newStep = (flow: FlowInfo, steps: PlanStep[], counter: number): { step: PlanStep; nextId: number } => {
  const { id, nextId } = nextStepId(steps, counter);
  const step: PlanStep = { id, title: flow.summary.split(/ \(|\. /)[0].replace(/\.$/, '').slice(0, 80), flow: flow.id, args: {}, executor: flow.executors[0] ?? 'deterministic' };
  const touches = deriveTouches(flow, {});
  if (touches) step.touches = touches;
  return { step, nextId };
};

export const removeStep = (steps: PlanStep[], id: string): PlanStep[] => {
  return steps
    .filter((s) => s.id !== id)
    .map((s) => (s.dependsOn?.includes(id) ? withDeps(s, s.dependsOn.filter((d) => d !== id)) : s));
};

export const moveStep = (steps: PlanStep[], id: string, dir: -1 | 1): PlanStep[] => {
  const from = steps.findIndex((s) => s.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  [next[from], next[to]] = [next[to], next[from]];
  const before = new Set<string>();
  return next.map((s) => {
    const kept = s.dependsOn?.filter((d) => before.has(d));
    before.add(s.id);
    return s.dependsOn && kept && kept.length !== s.dependsOn.length ? withDeps(s, kept) : s;
  });
};

function withDeps(step: PlanStep, deps: string[]): PlanStep {
  const { dependsOn: _drop, ...rest } = step;
  return deps.length ? { ...rest, dependsOn: deps } : rest;
}
