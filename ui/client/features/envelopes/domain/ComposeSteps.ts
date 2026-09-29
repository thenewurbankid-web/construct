// Pure (DOMAIN-001): add, remove and reorder compose steps -- #395/#771's center stage. Deliberately does not
// validate flow-specific args (that is the server's job on save, #772); these only keep the list well-formed
// and satisfy packages/core/plan.mjs's one structural requirement a bare `{}` args object cannot: a
// writes-flow step must declare `touches` (declared empty here, since this slice has no arg-editing UI yet).
// Structurally the same shape as features/plan/domain/StepList.ts's newStep/removeStep/moveStep, trimmed of
// Plan's `dependsOn` (an impact-analysis concept this standalone composer does not have yet).
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
  const touches = flow.writes ? { features: [], files: [] as [] } : undefined;
  const step: ComposeStep = { id, title: titleFrom(flow.summary), flow: flow.id, args: {}, executor, ...(touches ? { touches } : {}) };
  return { steps: [...steps, step], nextId };
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
