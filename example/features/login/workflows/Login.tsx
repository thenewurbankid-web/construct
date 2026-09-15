// The login flow's state machine. Workflows own application flow/state and
// may import domain + service (architecture.yml), but never React/UI
// (WORKFLOW-001) — navigation and rendering are the hook/controller's job.
import { setup, assign } from 'xstate';
import { isValidCredentials } from '../domain/Login';

type LoginEvent = { type: 'SUBMIT'; username: string; password: string };

export const LoginWorkflow = setup({
  types: {
    context: {} as { error: string | null },
    events: {} as LoginEvent,
  },
  guards: {
    isValid: (_, params: { username: string; password: string }) =>
      isValidCredentials(params.username, params.password),
  },
}).createMachine({
  id: 'login',
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
      entry: assign({ error: 'Invalid username or password.' }),
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
