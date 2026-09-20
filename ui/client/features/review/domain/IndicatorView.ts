// Pure (DOMAIN-001): how an indicator reads on its card. The headline sentence and the "where this
// comes from" line are the engine's, verbatim. "Not measured" (no plan) is a calm, neutral state with
// its reason, never red and never an empty box.
import type { FullIndicator, IndicatorCard, IndicatorStatus, Tone } from '../types.ts';

const STATUS: Record<IndicatorStatus, { label: string; tone: Tone }> = {
  clear: { label: 'Nothing found', tone: 'ok' },
  info: { label: 'Worth a look', tone: 'info' },
  attention: { label: 'Needs attention', tone: 'danger' },
  'not-measured': { label: 'Not measured', tone: 'neutral' },
};

export function buildIndicatorCard(i: FullIndicator): IndicatorCard {
  const s = STATUS[i.status] ?? STATUS['not-measured'];
  return {
    id: i.id,
    title: i.title,
    statusLabel: s.label,
    tone: s.tone,
    headline: i.headline,
    reason: !i.measured ? (i.reason ?? null) : null,
    source: i.source,
    findings: i.findings.map((f) => ({ id: f.id, title: f.title, resolutionLabel: f.resolution === 'mechanical' ? 'Can be fixed mechanically' : 'Needs a decision' })),
  };
}

/** Every indicator card, in the engine's order. */
export const buildIndicatorCards = (indicators: FullIndicator[]): IndicatorCard[] => indicators.map(buildIndicatorCard);

/** The one line under the stage title: what the whole change amounts to. */
export function changeHeadline(summary: string, unmeasured: boolean): string {
  return unmeasured ? `${summary} Scope is not measured (no plan is linked); every other check ran.` : summary;
}
