/** The Auto summary: plain sentences written by static rules from the feature's items, bases and imports (no model). */
export function AutoSummary({ sentences }: { sentences: string[] }) {
  return (
    <section className="lf-panel" aria-labelledby="lf-summary-title" data-testid="lf-summary">
      <h3 id="lf-summary-title">Auto summary</h3>
      <p className="lf-summary-text">{sentences.join(' ')}</p>
      <details className="lf-details">
        <summary>Details</summary>
        <p className="lf-muted">Written by fixed rules from the items, their bases and their imports; no model is used.</p>
      </details>
    </section>
  );
}
