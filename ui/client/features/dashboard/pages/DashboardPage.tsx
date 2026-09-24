import type { ReactNode } from 'react';
import { OfflineState } from '@/features/states';
import { CreateForm } from '../components/CreateForm';
import { ImportForm } from '../components/ImportForm';
import { RefactorForm } from '../components/RefactorForm';
import { ResearchForm } from '../components/ResearchForm';
import type { useDashboard } from '../hooks/useDashboard';

type DashboardPageProps = ReturnType<typeof useDashboard> & { modelOffline?: boolean };

// Props to JSX only (PAGE-002/003/004/005) — everything the four forms need
// arrives already assembled from the controller's useDashboard() call.
export function DashboardPage({ create, refactor, research, importForm, modelOffline = false }: DashboardPageProps): ReactNode {
  return (
    <div className="page page--screen">
      <h1>Dashboard</h1>
      <p className="hint">Start something here; each result shows what the tools did and whether a model helped.</p>
      {modelOffline && <OfflineState size="inline" />}
      <div className="dashboard-grid">
        <CreateForm {...create} />
      </div>
      {/* #391: Create is the first thing people do; the other three sit behind one collapsed disclosure. */}
      <details className="dashboard-more" data-testid="dashboard-more">
        <summary>More actions</summary>
        <div className="dashboard-grid">
          <RefactorForm {...refactor} />
          <ResearchForm {...research} />
          <ImportForm {...importForm} />
        </div>
      </details>
    </div>
  );
}
