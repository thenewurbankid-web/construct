import { Badge } from '@/components/ui';
import type { BranchIndicator } from '../types';

// Which kind of branch the project is on, next to the connection status. Text and a badge, never colour
// alone: "Session branch" means Cockpit made it (the dev server and Cockpit's saves share one working tree,
// so the guarantee holds), "Other branch" means Cockpit can work on it but does not control what else touches it.
export function BranchProvenance({ branch }: { branch: BranchIndicator }) {
  return (
    <p className="dev-server__branch" data-testid="branch-provenance" data-kind={branch.kind} title={branch.hint}>
      <Badge tone={branch.kind === 'session' ? 'tool' : 'llm-none'}>{branch.label}</Badge>
      <code data-testid="branch-name">{branch.name}</code>
      <span className="hint dev-server__branch-hint">{branch.hint}</span>
    </p>
  );
}
