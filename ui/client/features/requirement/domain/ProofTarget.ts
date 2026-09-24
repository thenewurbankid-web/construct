// Pure (DOMAIN-001): what the plan on screen says it proves (#653).
import type { ReadResult } from './RequirementTypes.ts';

/** What a plan says it proves: the feature its `test.proof` step runs and the screen's name, or null when it proves nothing (no shaped unit). */
export function proofTargetOf(result: ReadResult | null): { feature: string; screen: string } | null {
  const step = result?.plan?.steps.find((s) => s.flow === 'test.proof' && typeof s.args?.feature === 'string');
  if (!step) return null;
  const name = typeof step.args.name === 'string' ? step.args.name.replace(/Screen\.proof\.test\.ts$/, '') : '';
  return { feature: String(step.args.feature), screen: name || result?.proof?.steps[0]?.name || 'the screen' };
}
