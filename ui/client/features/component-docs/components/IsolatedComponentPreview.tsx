'use client';

import { useDevServerStatus } from '@/features/dev-server';
import { EmptyState } from '@/features/states';

type Props = { path: string };

/** #380 "Isolated view": the component rendered alone (no surrounding app) via the dev server's
 * `/__construct/component` harness (see `packages/engine/previewVitePlugin.mjs`). Clear empty state
 * when the dev server is not running -- there is nothing to frame. */
export function IsolatedComponentPreview({ path }: Props) {
  const { session } = useDevServerStatus();
  const url = session.status?.state === 'running' ? session.status.url : null;

  if (!url) {
    return (
      <EmptyState
        size="inline"
        title="Isolated preview needs the dev server"
        hint="Start the project's dev server (Preview panel) to see this component rendered on its own, with no surrounding page."
      />
    );
  }

  const src = `${url.replace(/\/$/, '')}/__construct/component?file=${encodeURIComponent(path)}&export=default`;
  return (
    <div className="cd-isolated-preview" data-testid="cd-isolated-preview">
      <iframe title="Isolated component preview" src={src} className="cd-isolated-frame" data-testid="cd-isolated-frame" />
    </div>
  );
}
