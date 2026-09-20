import type { FailureKind } from '../types';

/** Reading a failure: the two kinds side by side, so nobody raises a product bug for a harness problem. Reference
 * for reading a failure; a run's own failures are explained in full where they appear (#305). */
export function FailureKinds({ kinds }: { kinds: FailureKind[] }) {
  return (
    <details className="ts-kinds" data-testid="failure-kinds">
      <summary>When a test fails: two different things</summary>
      <p className="hint">Only the second is a bug in the app. This is how to read a failure, whether it came from Run all tests here or from a Playwright run in a terminal.</p>
      <div className="ts-kinds-grid">
        {kinds.map((k) => (
          <section key={k.id} className={`ts-banner ts-banner--${k.tone}`} data-testid={`kind-${k.id}`} aria-labelledby={`kind-${k.id}-h`}>
            <h3 id={`kind-${k.id}-h`}>{k.id === 'app' ? '✗ ' : ''}{k.title}</h3>
            <p>{k.what}</p>
            <pre className="ts-pre">{k.example}</pre>
            <p><strong>{k.action}</strong></p>
          </section>
        ))}
      </div>
    </details>
  );
}
