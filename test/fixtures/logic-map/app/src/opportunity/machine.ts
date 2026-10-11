import { createMachine } from 'xstate';

export const filterMachine = createMachine({
  id: 'filters',
  initial: 'all',
  states: {
    all: { on: { PICK: 'filtered' } },
    filtered: { on: { CLEAR: 'all' } },
  },
});
