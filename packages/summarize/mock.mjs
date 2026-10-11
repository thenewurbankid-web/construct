// cs1 -- the summarizer's mock: the same contract with canned output, for callers that test against it.
import { checkSentence } from './check.mjs';

/**
 * A summarizer that answers one fixed summary (or a per-kind table) and records every input.
 * @param {Partial<Record<import('./contract.mjs').SummaryInput['kind'], import('./contract.mjs').Summary>>} [table]
 */
export function createMockSummarizer(table = {}) {
  /** @type {import('./contract.mjs').SummaryInput[]} */
  const calls = [];
  const fallback = { sentences: ['Line has a message for you.'], details: [], via: /** @type {const} */ ('static') };
  return {
    calls,
    checkSentence,
    /** @param {import('./contract.mjs').SummaryInput} input @returns {import('./contract.mjs').Summary} */
    summarize(input) {
      calls.push(input);
      return table[input.kind] ?? fallback;
    },
  };
}
