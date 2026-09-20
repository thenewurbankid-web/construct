// Pure (DOMAIN-001): what the ticket pane shows about the constraints and the proposals, already as sentences.
import type { Constraints, Proposal } from './PlanTypes.ts';
import type { ConstraintsView, ProposalView } from '../types.ts';

export const constraintsView = (c: Constraints): ConstraintsView => ({
  summary: `${c.framework ?? 'framework not set'} · ${c.layers.length} layers · ${c.rules.length} rules on${c.frozen.length ? ` · ${c.frozen.length} frozen region(s)` : ''}`,
  rules: c.rules,
});

export const proposalView = (p: Proposal): ProposalView => ({ ref: p.ref, badge: `inferred ${Math.round(p.confidence * 100)}%`, why: p.why });
