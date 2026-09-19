import type { ReactNode } from 'react';
import type { InlineSegment, NarrativeMachineView } from '../types';

function Inline({ segments }: { segments: InlineSegment[] }): ReactNode {
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'state' ? <em key={i} className="wf-nar-state">{seg.value}</em> : seg.kind === 'code' ? <code key={i}>{seg.value}</code> : <span key={i}>{seg.value}</span>,
      )}
    </>
  );
}

// Plain-English view of one machine: what each state does, every route from
// start to an end state, and structural health findings. Read-only
// presentation of what the server derived from the real source.
export function MachineNarrative({ narrative }: { narrative: NarrativeMachineView }) {
  if (narrative.error) {
    return <p className="hint" data-testid="wf-narrative-unavailable">{narrative.summary}</p>;
  }
  return (
    <div className="wf-narrative" data-testid="wf-narrative">
      <section className="wf-nar-panel" data-testid="wf-narrative-english">
        <h4>In plain English</h4>
        <p className="wf-nar-summary" data-testid="wf-narrative-summary"><Inline segments={narrative.summarySegments} /></p>
        {narrative.contextSegments.length > 0 && (
          <div className="wf-nar-state-block" data-testid="wf-narrative-context">
            <h5>What it remembers</h5>
            <ul>
              {narrative.contextSegments.map((segs, i) => (
                <li key={i}><Inline segments={segs} /></li>
              ))}
            </ul>
          </div>
        )}
        {narrative.states.map((st) => (
          <div key={st.path} className={`wf-nar-state-block ${st.kind}`} data-testid={`wf-narrative-state-${st.path}`}>
            <h5>{st.label} <span className="wf-tag">{st.kind}</span></h5>
            <ul>
              {st.sentenceSegments.map((segs, i) => (
                <li key={i}><Inline segments={segs} /></li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="wf-nar-panel" data-testid="wf-narrative-scenarios">
        <h4>Scenarios</h4>
        {narrative.scenarios.length === 0 && <p className="hint">No complete route from the start to an end state was found.</p>}
        {narrative.scenarios.map((sc) => (
          <div key={sc.id} className={`wf-nar-scenario${sc.happy ? ' happy' : ''}`} data-testid={`wf-scenario-${sc.id}`}>
            <h5>
              {sc.title}
              {sc.end.outcome === 'stuck' && <span className="wf-tag missing">stuck</span>}
            </h5>
            <p className="hint">{sc.route}</p>
            <ul className="wf-nar-gwt">
              {sc.lineSegments.map((segs, i) => (
                <li key={i}><Inline segments={segs} /></li>
              ))}
            </ul>
          </div>
        ))}
        {narrative.truncated && <p className="hint">Showing the first {narrative.scenarios.length} scenarios; this flow has more.</p>}
      </section>

      <section className="wf-nar-panel" data-testid="wf-narrative-health">
        <h4>Health</h4>
        {narrative.findings.length === 0 ? (
          <p className="wf-nar-ok" data-testid="wf-health-ok">No problems found: every step is reachable and every non-final step has a way out.</p>
        ) : (
          <ul>
            {narrative.findings.map((f, i) => (
              <li key={i} className={`wf-finding ${f.severity}`} data-testid={`wf-finding-${f.kind}`}>
                <span className="wf-tag missing">{f.kind}</span> <Inline segments={f.messageSegments} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
