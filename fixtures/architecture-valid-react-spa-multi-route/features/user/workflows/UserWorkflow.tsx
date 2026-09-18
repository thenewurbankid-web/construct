import { setup } from 'xstate';
import { fetchUser } from '../services/UserService';

export const UserWorkflow = setup({}).createMachine({
  id: 'user',
  initial: 'idle',
  states: { idle: {} },
});

export { fetchUser };
