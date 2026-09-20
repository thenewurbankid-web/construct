/** No tests yet (#306): a heading, a plain explanation and a next action. "New test" needs authoring (#304), which is
 * not built yet, so it is shown as unavailable with the reason rather than hidden. */
export function EmptyTests({ count, generating, onGenerate }: { count: number; generating: boolean; onGenerate: () => void }) {
  return (
    <section className="ts-state" data-testid="state-empty" aria-labelledby="state-empty-h">
      <h2 id="state-empty-h" className="ts-state-h">No tests for this feature yet</h2>
      <p>Construct already worked out <strong>{count} {count === 1 ? 'way' : 'ways'}</strong> this flow can run. Generate a test for {count === 1 ? 'it' : 'them'} in one step, or write your own.</p>
      <div className="ts-actions">
        <button type="button" className="ts-btn ts-btn--primary" data-testid="empty-generate" disabled={generating} onClick={onGenerate}>{generating ? 'Generating...' : `Generate ${count} ${count === 1 ? 'test' : 'tests'}`}</button>
        <button type="button" className="ts-btn" disabled aria-describedby="state-empty-why" data-testid="empty-new">New test</button>
      </div>
      <p className="hint" id="state-empty-why">Writing a test from scratch is not available yet. Add a *.spec.ts under the feature's tests/ folder for now.</p>
    </section>
  );
}
