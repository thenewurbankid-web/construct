import type { ReactNode } from 'react';
import { BranchProvenance } from '../components/BranchProvenance';
import { DevServerCard } from '../components/DevServerCard';
import type { DevServerHandlers, DevServerView } from '../types';

type DevServerPageProps = DevServerHandlers & { view: DevServerView; error: string | null };

// The live preview's connection status: which state the target app's dev server is in, what to do about it,
// and which kind of branch it is running on. Rendered inside the Pages editor (a slot, like commit-on-save), so
// it sits where the preview is, not on a screen of its own.
export function DevServerPage({ view, ...handlers }: DevServerPageProps): ReactNode {
  return (
    <section className="dev-server" data-testid="dev-server" data-state={view.card} aria-label="Dev server">
      <div role="status" aria-live="polite">
        <DevServerCard view={view} {...handlers} />
      </div>
      {view.branch && <BranchProvenance branch={view.branch} />}
    </section>
  );
}
