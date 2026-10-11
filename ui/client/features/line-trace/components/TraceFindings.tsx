import Link from 'next/link';
import type { FindingsView } from '../types';

/** One plain line of the Trace bar, or nothing. */
function Note({ text, testId }: { text: string | null; testId: string }) {
  if (!text) return null;
  return (
    <p className="ltr-hint" data-testid={testId}>
      {text}
    </p>
  );
}

const linkItem = (l: FindingsView['elsewhere'][number]) => (
  <li key={l.key}>
    <Link href={l.href} className="ltr-link" data-testid="trace-elsewhere">
      {l.text}
    </Link>
  </li>
);

/** A link to each other screen with lit controls. */
function Elsewhere({ links }: { links: FindingsView['elsewhere'] }) {
  if (!links.length) return null;
  return (
    <ul className="ltr-links" aria-label="Lit on other screens">
      {links.map(linkItem)}
    </ul>
  );
}

const detail = (text: string) => <li key={text}>{text}</li>;

/** What Trace found: how a tie was decided, what is lit here, links to other screens, what Auto still needs, and
 * (under Details) the tools and whether static or jev decided. */
export function TraceFindings({ findings }: { findings: FindingsView }) {
  if (!findings.details.length) return null;
  return (
    <div className="ltr-findings">
      <Note text={findings.choice} testId="trace-choice" />
      <Note text={findings.litHere} testId="trace-lit-here" />
      <Elsewhere links={findings.elsewhere} />
      <Note text={findings.missing} testId="trace-missing" />
      <details className="ltr-tech">
        <summary>Details</summary>
        <ul>{findings.details.map(detail)}</ul>
      </details>
    </div>
  );
}
