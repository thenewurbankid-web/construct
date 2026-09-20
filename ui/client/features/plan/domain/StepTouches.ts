// Pure (DOMAIN-001): what a step will touch, worked out from its own arguments.
import type { FlowInfo, PlanStep } from './PlanTypes.ts';

export const deriveTouches = (flow: FlowInfo | null, args: Record<string, unknown>): PlanStep['touches'] | undefined => {
  if (!flow || !flow.writes) return undefined;
  const features: string[] = [];
  const feature = typeof args.feature === 'string' && args.feature ? args.feature : flow.id === 'create.feature' && typeof args.name === 'string' && args.name ? args.name : null;
  if (feature) features.push(feature);
  return { features, files: [] };
};
