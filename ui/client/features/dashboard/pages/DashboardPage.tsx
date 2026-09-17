import type { ReactNode } from 'react';
import { CreateForm } from '../components/CreateForm';
import { ImportForm } from '../components/ImportForm';
import { RefactorForm } from '../components/RefactorForm';
import { ResearchForm } from '../components/ResearchForm';
import type { useDashboard } from '../hooks/useDashboard';

type DashboardPageProps = ReturnType<typeof useDashboard>;

// Props to JSX only (PAGE-002/003/004/005) — everything the four forms need
// arrives already assembled from the controller's useDashboard() call.
export function DashboardPage({ create, refactor, research, importForm }: DashboardPageProps): ReactNode {
  return (
    <div className="page">
      <h1>Dashboard</h1>
      <p className="hint">
        Click-through equivalents of the CLI&apos;s create/refactor/research/import commands. Each
        result shows the deterministic tool output and, distinctly, any LLM involvement.
      </p>
      <div className="dashboard-grid">
        <CreateForm {...create} />
        <RefactorForm {...refactor} />
        <ResearchForm {...research} />
        <ImportForm {...importForm} />
      </div>
    </div>
  );
}
