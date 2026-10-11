import type { AgentScreen } from '../types';

const item = (text: string, i: number) => <li key={`${i}-${text}`}>{text}</li>;

/** How the agent decided, and every recorded change (who, what), collapsed. */
export function AgentRecord({ screen }: { screen: AgentScreen }) {
  if (!screen.started) return null;
  return (
    <section className="la-card" aria-labelledby="la-record-h">
      <h2 id="la-record-h" className="la-h2">Record</h2>
      <p className="la-hint">{screen.decider}</p>
      <details className="la-more" data-testid="la-decisions" hidden={!screen.decisions.length}>
        <summary>{`How the agent decided (${screen.decisions.length})`}</summary>
        <ul className="la-list">{screen.decisions.map(item)}</ul>
      </details>
      <details className="la-more" data-testid="la-changes">
        <summary>{`Every change (${screen.changes.length})`}</summary>
        <ol className="la-list">{screen.changes.map(item)}</ol>
      </details>
    </section>
  );
}
