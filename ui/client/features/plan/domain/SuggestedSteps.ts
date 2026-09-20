// Pure (DOMAIN-001): read-only steps an impact report suggests. Derived from the report's own features and files, never invented.
import type { ImpactReport, PlanStep } from './PlanTypes.ts';

export function suggestedSteps(report: ImpactReport | null, existing: PlanStep[]): Omit<PlanStep, 'id'>[] {
  if (!report) return [];
  const have = new Set(existing.map((s) => `${s.flow}|${JSON.stringify(s.args)}`));
  const out: Omit<PlanStep, 'id'>[] = [];
  for (const f of report.features.filter((x) => x.kind === 'feature').slice(0, 3)) {
    const step = { title: `Read ${f.name} in full`, flow: 'summarize.unit', args: { ref: `feature:${f.name}`, detail: 'full' }, executor: 'deterministic' as const };
    if (!have.has(`${step.flow}|${JSON.stringify(step.args)}`)) out.push(step);
  }
  const wf = report.files.find((f) => f.layer === 'workflow' && f.feature);
  if (wf?.feature) {
    const step = { title: `Check the ${wf.feature} workflow scenarios`, flow: 'research.workflow', args: { feature: wf.feature }, executor: 'deterministic' as const };
    if (!have.has(`${step.flow}|${JSON.stringify(step.args)}`)) out.push(step);
  }
  return out;
}
