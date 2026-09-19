import type { ReactNode } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { OfflineState } from '../components/OfflineState';
import type { StatesGalleryProps } from '../types';

/** Design reference: the four shared states side by side, exactly as every
 * screen renders them. Not linked from the navigation; reachable at /states. */
export function StatesGalleryPage({ retries, retrying, onRetry }: StatesGalleryProps): ReactNode {
  return (
    <div className="page page--screen">
      <h1>Shared states</h1>
      <p className="hint">
        Every screen uses these four states when it has nothing to show, is loading, has failed, or
        the local model is offline. Each says what happened and what to do next.
      </p>
      <div className="states-grid">
        <section aria-label="Empty">
          <h2>Empty</h2>
          <EmptyState
            title="Open a project to start"
            hint="Pick a folder that contains an architecture.yml, or create a new project."
            actions={[{ label: 'Open Settings', href: '/settings', primary: true }]}
          />
        </section>
        <section aria-label="Loading">
          <h2>Loading</h2>
          <LoadingState label="Scanning 41 files" hint="Deterministic: no model involved." percent={55} />
        </section>
        <section aria-label="Error">
          <h2>Error</h2>
          <ErrorState
            title="Preview could not start"
            hint="Port 5173 is already in use by another process."
            onRetry={onRetry}
            retrying={retrying}
          />
          <p className="hint" role="status" data-testid="retry-count">
            Retried {retries} {retries === 1 ? 'time' : 'times'}
          </p>
        </section>
        <section aria-label="Model offline">
          <h2>Model offline</h2>
          <OfflineState />
        </section>
      </div>
    </div>
  );
}
