// Sign-in gate: a protected page is shown only after signing in; Sign out returns to the sign-in page.
import { setup } from 'xstate';

/** The pages this workflow needs: a feature fills each role with one of its own pages. */
export const roles = {
  signIn: 'The sign-in page',
  inside: 'The page shown once the person is signed in',
};

export const signInGate = setup({
  actions: {
    callService: (_: unknown, _params: { service: string }) => {},
    setPartState: (_: unknown, _params: { part: string; state: string }) => {},
  },
}).createMachine({
  id: 'signInGate',
  initial: 'signIn',
  states: {
    signIn: { on: { SIGNED_IN: 'inside' } },
    inside: { on: { SIGN_OUT: 'signIn' } },
  },
});
