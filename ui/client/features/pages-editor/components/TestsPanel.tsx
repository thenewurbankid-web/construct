'use client';

import { coverageSummary } from '@/features/tests';
import type { PageTestsCoverage } from '../hooks/useTestsCoverage';

type TestsPanelProps = { coverage: PageTestsCoverage | null };

// #830 -- design 8.2/9's "Tests" inspector section: the open page's feature's scenario coverage (/api/tests/:feature
// via useTestsCoverage), collapsed by default and one-line while closed, the same `.pal-group` disclosure
// Impact/Scope/Auto-map already use. `scenarios === 0` is an honest zero state (no workflow to cover yet), not an
// error -- the feature's coverageError, when present, says why.
export function TestsPanel({ coverage }: TestsPanelProps) {
  const summaryText =
    coverage === null ? 'checking…' : !coverage.ok ? 'unknown' : coverage.data.scenarios === 0 ? 'no coverage' : coverageSummary(coverage.data);
  return (
    <details className="tests-panel pal-group" data-testid="tests-panel">
      <summary>
        Tests <span className="pal-count" data-testid="tests-count">{summaryText}</span>
      </summary>
      {coverage?.ok && (coverage.data.scenarios === 0 ? (
        <p className="hint">This feature has no scenarios to cover yet.</p>
      ) : (
        <ul className="tests-coverage-list" data-testid="tests-coverage-list">
          {coverage.data.coverage.map((row) => (
            <li key={row.id}>
              {row.title} <span className="hint">{row.generated ? 'generated test' : 'no test'}</span>
            </li>
          ))}
        </ul>
      ))}
    </details>
  );
}
