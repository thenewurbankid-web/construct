// Pure (DOMAIN-001): how many changes a draft is waiting to save, and the plain-language problems that would make
// the server refuse it (the server stays the authority).
import type { DraftStep, StepFields } from '../types.ts';
import { changeOf } from './StepDraft.ts';

const TEXT_LIMIT = 200;

/** True when the surviving original rows are no longer in their original order. */
const reordered = (draft: DraftStep[]): boolean => {
  const origins = draft.filter((d) => d.origin !== null && !d.removed).map((d) => d.origin as number);
  return origins.some((o, i) => i > 0 && o < origins[i - 1]);
};

/** How many changes are waiting: added + removed + changed rows, plus one if the order changed. */
export function changeCount(draft: DraftStep[], original: StepFields[]): number {
  return draft.filter((d) => changeOf(d, original) !== null).length + (reordered(draft) ? 1 : 0);
}

export function problemsOf(draft: DraftStep[]): string[] {
  const out: string[] = [];
  draft.filter((d) => !d.removed).forEach((d, i) => {
    const s = d.step;
    if (s.kind === 'check-text' && !s.text.trim()) out.push(`Step ${i + 1}: type the text the page should show.`);
    if (s.kind === 'check-text' && s.text.length > TEXT_LIMIT) out.push(`Step ${i + 1}: the text is longer than ${TEXT_LIMIT} characters.`);
    if (s.kind === 'goto' && s.url !== null && !/^\/(?!\/)[\w\-./~?=&%+#]*$/.test(s.url)) out.push(`Step ${i + 1}: the address must be a path on this site, like /refunds/new.`);
    if ((s.kind === 'event' && !s.event) || (s.kind === 'state' && !s.state)) out.push(`Step ${i + 1}: this flow has nothing to pick here.`);
    if ('note' in s && s.note && s.note.length > TEXT_LIMIT) out.push(`Step ${i + 1}: the note is longer than ${TEXT_LIMIT} characters.`);
  });
  return out;
}
