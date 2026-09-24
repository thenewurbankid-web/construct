import type { ProofFailureView } from '../types';

/** One failed test of the proof, in the words of the Tests screen: an app failure names the state that is wrong; a harness problem is not a product bug. */
export function ProofFailure({ failure }: { failure: ProofFailureView }) {
  return (
    <section className={`rq-fail rq-fail--${failure.kind}`} data-testid="proof-failure" data-kind={failure.kind} aria-label={`Why the proof failed: ${failure.heading}`}>
      <h3 className="rq-h3-plain"><span aria-hidden="true">{failure.symbol} </span>{failure.heading}</h3>
      <p data-testid="proof-failure-summary">{failure.summary}</p>
      {failure.facts.map((fact) => <p key={fact.id} className="rq-muted" data-testid={`proof-${fact.id}`}>{fact.text}</p>)}
      {failure.message && <pre className="rq-pre" tabIndex={0} aria-label="What the proof said, as text" data-testid="proof-failure-message">{failure.message}</pre>}
      {failure.notes.map((note) => <p key={note} className="rq-muted">{note}</p>)}
    </section>
  );
}
