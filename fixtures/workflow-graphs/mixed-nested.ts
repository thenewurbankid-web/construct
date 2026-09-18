import { createMachine } from 'xstate';

// Nested states, always/after/invoke, array transitions, ids, targetless
// transitions, inline guards: exercised by the workflow narrator's golden tests.
export const m = createMachine({
  id: 'root',
  initial: 'a',
  states: {
    a: {
      initial: 'a1',
      states: { a1: { on: { NEXT: 'a2' } }, a2: { type: 'final' } },
      onDone: 'b',
      on: { CANCEL: 'other' },
      exit: 'cleanUp',
    },
    b: {
      always: [{ target: 'c', guard: ({ context }) => context.x > 1 }, { target: '#root.a' }],
      after: { 1000: 'c' },
      on: { PING: { actions: 'log' } },
      invoke: { src: 'x', onDone: 'c', onError: { target: 'c', guard: { type: 'isFatal' } } },
    },
    c: { on: { BACK: '#other', UP: [{ target: 'a', guard: 'canRetry' }, 'b'] } },
    other: { id: 'other' },
  },
});
