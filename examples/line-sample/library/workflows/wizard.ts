// Step-by-step wizard: a first step, a second step and a review page; Next and Back move between them, Finish ends it.
import { setup } from 'xstate';

/** The pages this workflow needs: a feature fills each role with one of its own pages. */
export const roles = {
  first: 'The first step of the wizard',
  second: 'The second step of the wizard',
  review: 'The page where the person checks everything before finishing',
};

export const wizard = setup({
  actions: {
    callService: (_: unknown, _params: { service: string }) => {},
    setPartState: (_: unknown, _params: { part: string; state: string }) => {},
  },
}).createMachine({
  id: 'wizard',
  initial: 'first',
  states: {
    first: { on: { NEXT: 'second', CANCEL: 'cancelled' } },
    second: { on: { NEXT: 'review', BACK: 'first', CANCEL: 'cancelled' } },
    review: { on: { FINISH: 'done', BACK: 'second' } },
    done: { type: 'final' },
    cancelled: { type: 'final' },
  },
});
