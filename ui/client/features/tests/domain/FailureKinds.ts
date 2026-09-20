import type { FailureKind } from '../types.ts';
// Pure (DOMAIN-001): the two ways a generated test can fail, in words. The wording of the first mirrors what the
// generated harness prints (src/engine/testSpecRender.mjs): a missing data-testid is a harness problem, not a bug.

export const FAILURE_KINDS: FailureKind[] = [
  {
    id: 'convention',
    title: 'Convention not met',
    tone: 'warn',
    what: 'The test could not find the element the flow says it should click. Construct binds each workflow event to an element by convention (data-testid = the event name in kebab-case), and nothing on the page has it.',
    example: 'Missing [data-testid="request-refund"]. It is what the workflow event REQUEST_REFUND binds to.',
    action: 'Not a product bug: the page was never exercised. Do not raise a ticket against the app. Add the attribute, then run again.',
  },
  {
    id: 'app',
    title: 'App behaved differently',
    tone: 'error',
    what: 'The element was found and the click worked, but the flow did not reach the state the test expected. This is the failure that tells you the product did something else.',
    example: 'Expected the flow to reach "manual review", it reached "approved".',
    action: 'This is the kind worth a bug report. Note the step, the state expected and the state reached.',
  },
];
