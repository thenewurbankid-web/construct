// Pure (DOMAIN-001): add, remove and reorder compose steps -- #395/#771's center stage. Deliberately does not
// validate (that is the server's job once save/run exists, #772); these only keep the list well-formed.
// Structurally the same shape as features/plan/domain/StepList.ts's newStep/removeStep/moveStep, trimmed of
// Plan's `dependsOn`/`touches` (impact-analysis concepts this standalone composer does not have yet).
import type { ComposeStep, Executor, FlowCatalogueEntry } from '../types';

function genId(steps: ComposeStep[], counter: number): { id: string; nextId: number } {
  let n = counter;
  let id = `step-${n}`;
  while (steps.some((s) => s.id === id)) {
    n += 1;
    id = `step-${n}`;
  }
  return { id, nextId: n + 1 };
}

const titleFrom = (summary: string): string => summary.split(/ \(|\. /)[0].replace(/\.$/, '').slice(0, 80);

export function addComposeStep(flow: FlowCatalogueEntry, steps: ComposeStep[], counter: number): { steps: ComposeStep[]; nextId: number } {
  const { id, nextId } = genId(steps, counter);
  const executor: Executor = flow.executors[0] ?? 'deterministic';
  return { steps: [...steps, { id, title: titleFrom(flow.summary), flow: flow.id, args: {}, executor }], nextId };
}

export function removeComposeStep(steps: ComposeStep[], id: string): ComposeStep[] {
  return steps.filter((s) => s.id !== id);
}

export function moveComposeStep(steps: ComposeStep[], id: string, dir: -1 | 1): ComposeStep[] {
  const from = steps.findIndex((s) => s.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
