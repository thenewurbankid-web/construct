// Pure (DOMAIN-001): what a step binds to and the statement it becomes. Display only: the authoritative text is the
// diff the server returns at review.
import type { StepFields } from '../types.ts';

/** The selector or call a step binds to (the convention: data-testid from the event, data-flow-state from the state). */
export function bindingOf(step: StepFields): string {
  switch (step.kind) {
    case 'fixme': return 'test.fixme';
    case 'goto': return 'page.goto';
    case 'event': return `[data-testid="${step.testId}"]`;
    case 'check-text': return 'text is visible';
    default: return `[data-flow-state="${step.state}"]`;
  }
}

/** A read-only preview of the statement this step becomes. */
export function codeOf(step: StepFields): string {
  switch (step.kind) {
    case 'fixme': return `test.fixme(true, ${JSON.stringify(step.text)});`;
    case 'goto': return 'await page.goto(START_URL);';
    case 'event': return `await trigger(page, ${JSON.stringify(step.testId)}, ${JSON.stringify(step.event)});`;
    case 'check-text': return `await expect(page.getByText(${JSON.stringify(step.text)})).toBeVisible({ timeout: ${step.timeout} });`;
    default: return `await expectFlowState(page, MACHINE, ${JSON.stringify(step.state)}${step.timeout ? `, ${step.timeout}` : ''});`;
  }
}

/** The label next to a row that changed since it was opened. */
export const CHANGE_LABEL = { added: 'Added by you', removed: 'Removed by you: kept here until you save', changed: 'Changed by you' } as const;
