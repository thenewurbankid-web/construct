import { setup } from 'xstate';

export const CoreWorkflow = setup({}).createMachine({
  id: 'core',
  initial: 'idle',
  states: { idle: {} }
});
