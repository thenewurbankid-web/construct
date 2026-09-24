/** No tests yet (#306): a heading, one plain sentence and ONE primary action (#391). The disabled "New test" button
 * and its "not available yet" paragraph are gone: authoring (#304) is not built, and an unavailable button is noise. */
export function EmptyTests({ count, generating, onGenerate }: { count: number; generating: boolean; onGenerate: () => void }) {
  return (
    <section className="ts-state" data-testid="state-empty" aria-labelledby="state-empty-h">
      <h2 id="state-empty-h" className="ts-state-h">No tests for this feature yet</h2>
      <p>Construct already worked out <strong>{count} {count === 1 ? 'way' : 'ways'}</strong> this flow can run. Generate a test for {count === 1 ? 'it' : 'them'} in one step, or write your own.</p>
      <div className="ts-actions">
        <button type="button" className="ts-btn ts-btn--primary" data-testid="empty-generate" disabled={generating} onClick={onGenerate}>{generating ? 'Generating...' : `Generate ${count} ${count === 1 ? 'test' : 'tests'}`}</button>
      </div>
    </section>
  );
}
