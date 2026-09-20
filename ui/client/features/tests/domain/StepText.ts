// Pure (DOMAIN-001): the words of one step. Display only: the server re-derives and re-validates everything on write.
import type { StepFields } from '../types.ts';

/** "REQUEST_REFUND" / "requestRefund" / "manual.review" -> "request refund" / "manual review". */
export function humanize(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').trim().toLowerCase();
}

/** GIVEN / AND / WHEN / THEN / CHECK (NEEDS for a "this test needs..." note), from a step and the one before it. */
export function keywordOf(step: StepFields, prev: StepFields | null): string {
  switch (step.kind) {
    case 'fixme': return 'NEEDS';
    case 'goto': return 'GIVEN';
    case 'event': return 'WHEN';
    case 'check-text': return 'CHECK';
    default: return prev?.kind === 'event' ? 'THEN' : 'AND';
  }
}

export function sentenceOf(step: StepFields, prev: StepFields | null): string {
  switch (step.kind) {
    case 'fixme': return step.text;
    case 'goto': return step.url === null ? 'Open the feature (no route reaches it yet)' : `Open ${step.url}`;
    case 'event': return `"${humanize(step.event)}" happens`;
    case 'check-text': return step.text ? `the page shows "${step.text}"` : 'the page shows (type the text to look for)';
    default: return `the flow ${prev?.kind === 'goto' ? 'starts at' : 'moves to'} ${humanize(step.state)}`;
  }
}
