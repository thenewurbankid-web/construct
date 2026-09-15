import { setup } from 'xstate';

export const AlphaWorkflow = setup({}).createMachine({
  id: 'alpha',
  initial: 'idle',
  states: { idle: {} },
});
