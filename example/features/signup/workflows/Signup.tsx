import { setup, assign } from 'xstate';
import { isEmailValid, isPasswordValid, isUsernameValid } from '../domain/Signup';

type SignupEvent = { type: 'SUBMIT'; username: string; email: string; password: string };

export const SignupWorkflow = setup({
  types: {
    context: {} as { error: string | null },
    events: {} as SignupEvent,
  },
  guards: {
    isValid: (_, params: { username: string; email: string; password: string }) =>
      isUsernameValid(params.username) && isEmailValid(params.email) && isPasswordValid(params.password),
  },
}).createMachine({
  id: 'signup',
  initial: 'idle',
  context: { error: null },
  states: {
    idle: {
      on: {
        SUBMIT: [
          { guard: { type: 'isValid', params: ({ event }) => event }, target: 'success' },
          { target: 'rejected' },
        ],
      },
    },
    rejected: {
      entry: assign({ error: 'Please check your username, email, and password.' }),
      on: {
        SUBMIT: [
          { guard: { type: 'isValid', params: ({ event }) => event }, target: 'success' },
          { target: 'rejected' },
        ],
      },
    },
    success: { type: 'final' },
  },
});
