import type { FindingsSummaryProps } from '../types';

/** Drawer tab: how many findings there are, and how many of them are mechanical. One line, then the split. */
export function FindingsSummary({ summary, mechanical, conversation, degraded }: FindingsSummaryProps) {
  return (
    <div className="rv-side" data-testid="review-findings-drawer">
      <p className="rv-lede" data-testid="review-drawer-summary">{summary}</p>
      <ul className="rv-drawer-split">
        <li><span aria-hidden="true">✓ </span>{mechanical} can be fixed mechanically</li>
        <li><span aria-hidden="true">◆ </span>{conversation} need a decision</li>
      </ul>
      {degraded && <p className="rv-hint">{degraded}</p>}
    </div>
  );
}
