import Link from 'next/link';

/** #642: the way from the Plan screen to the Requirement screen, which turns one sentence into a plan you approve. */
export function RequirementLink() {
  return (
    <p className="hint" data-testid="plan-requirement-link">
      Rather start from one sentence? <Link href="/requirement">Requirement</Link> reads it into a card, a placement and a timeline, then hands you a plan to approve.
    </p>
  );
}
