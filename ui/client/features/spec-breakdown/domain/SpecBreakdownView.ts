// #748 (R6) -- pure view-model builders (DOMAIN-001: no fetch, no React, no dates). The server hands the UI a
// read-back (#672, per-requirement-sentence groups of states/events/transitions/functions), not the spec's flat
// lists directly, so the table view is built by flattening those groups and deduping by id -- the only place
// this screen invents structure the server does not already hand it.
import type { ReadBack, ReadBackSentence, SpecRow, SpecRowGroup } from '../types';

const GROUPS: SpecRowGroup[] = ['states', 'events', 'transitions', 'functions'];

/** The spec's states/events/transitions/functions, one row per id, in first-seen order across sentences. */
export function specRows(readBack: ReadBack): SpecRow[] {
  const seen = new Map<string, SpecRow>();
  for (const sentence of readBack.sentences) {
    for (const group of GROUPS) {
      for (const item of sentence[group]) {
        const key = `${group}:${item.id}`;
        if (!seen.has(key)) seen.set(key, { id: item.id, group, text: item.text, req: item.req });
      }
    }
  }
  return [...seen.values()];
}

/** Rows of one group only, in the table's declared order (states, events, transitions, functions). */
export function rowsByGroup(readBack: ReadBack, group: SpecRowGroup): SpecRow[] {
  return specRows(readBack).filter((r) => r.group === group);
}

export type SentenceView = ReadBackSentence & { tone: 'ok' | 'warn' | 'error' };

/** The read-back's sentences, each tagged with a display tone: covered is the calm default, an explicit
 * out-of-scope call is a deliberate decision (warn, not an error), and uncovered is the one state that means
 * "the spec does not account for this sentence" (error) -- the "diff against the original requirement" the
 * acceptance criteria asks for: every original sentence, and whether the spec accounts for it. */
export function sentenceViews(readBack: ReadBack): SentenceView[] {
  return readBack.sentences.map((s) => ({ ...s, tone: s.status === 'covered' ? 'ok' : s.status === 'out-of-scope' ? 'warn' : 'error' }));
}

/** One line summarizing whether the requirement is fully accounted for, for a heading. */
export function coverageSummary(readBack: ReadBack): string {
  const c = readBack.counts;
  return `${c.sentences} sentence(s): ${c.covered} covered, ${c.outOfScope} out of scope${c.uncovered ? `, ${c.uncovered} NOT covered` : ''}.`;
}
