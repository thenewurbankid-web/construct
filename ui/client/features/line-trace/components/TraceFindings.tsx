import Link from 'next/link';
import type { TraceLights, TraceMatch } from '../types';

const item = (text: string, i: number) => <li key={`${text}-${i}`}>{text}</li>;

/** What Trace found: which controls are lit here, a link to each other screen with lit controls, what Auto still needs,
 * and (under Details) the tools and whether static or jev decided. */
export function TraceFindings({ match, lights, showLights }: { match: TraceMatch | null; lights: TraceLights; showLights: boolean }) {
  if (!match) return null;
  const first = match.tools[0];
  return (
    <div className="ltr-findings">
      {match.choice && (
        <p className="ltr-hint" data-testid="trace-choice">
          {match.choice.sentence}
        </p>
      )}
      {showLights && lights.here.length > 0 && (
        <p className="ltr-hint" data-testid="trace-lit-here">
          Lit here: {lights.here.map((c) => c.label).join(', ')}.
        </p>
      )}
      {showLights && lights.elsewhere.length > 0 && (
        <ul className="ltr-links" aria-label="Lit on other screens">
          {lights.elsewhere.map((l) => (
            <li key={l.screen}>
              <Link href={l.href} className="ltr-link" data-testid="trace-elsewhere">
                Go to {l.title}: {l.labels.join(', ')} light up there.
              </Link>
            </li>
          ))}
        </ul>
      )}
      {first?.missing && first.from === 'request' && (
        <p className="ltr-hint" data-testid="trace-missing">
          {first.missing}
        </p>
      )}
      <details className="ltr-tech">
        <summary>Details</summary>
        <ul>
          {match.tools.map((t, i) => item(`${t.toolId}${t.stepId ? ` (step ${t.stepId})` : ''}: ${t.controls.map((c) => c.controlId).join(', ')}`, i))}
          {item(`Decided by: ${match.via}${match.alternatives.length ? `; also possible: ${match.alternatives.join(', ')}` : ''}`, -1)}
        </ul>
      </details>
    </div>
  );
}
