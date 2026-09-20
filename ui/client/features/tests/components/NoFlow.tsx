import type { TestsListing } from '../types';

/** A feature with no readable flow (#306): says why nothing can be generated, lists the machines Construct skipped
 * and why, and still allows a hand-written test (shown as unavailable until authoring, #304, exists). */
export function NoFlow({ feature, skipped }: { feature: string; skipped: TestsListing['skipped'] }) {
  return (
    <section className="ts-state" data-testid="state-no-flow" aria-labelledby="state-noflow-h">
      <h2 id="state-noflow-h" className="ts-state-h">This feature has no flow to test</h2>
      <p>Generated tests come from a flow (an XState machine in <span className="ts-mono">features/{feature}/workflows/</span>). This feature has none that Construct can read, so there is nothing to generate. You can still write a test by hand.</p>
      {skipped.length > 0 && (
        <ul className="ts-gets" aria-label="Machines that were skipped">
          {skipped.map((s) => (
            <li key={`${s.file}:${s.machine}`}><span className="ts-mono">{s.file}</span> ({s.machine}): {s.reason}</li>
          ))}
        </ul>
      )}
      <div className="ts-actions">
        <button type="button" className="ts-btn" disabled aria-describedby="state-noflow-why" data-testid="noflow-new">New blank test</button>
      </div>
      <p className="hint" id="state-noflow-why">Writing a test from scratch is not available yet. Add a *.spec.ts under the feature's tests/ folder for now.</p>
    </section>
  );
}
