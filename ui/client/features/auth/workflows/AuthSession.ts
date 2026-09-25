import type { AuthSession } from '../types';

// Workflows own application state and flow but never import React
// (WORKFLOW-001) — a plain reducer, driven by the hook's useReducer.
//
// #664: two independent questions, each a status union instead of a bag of flags.
//   - `load`: what `/auth/session` has told us. One status at a time, so a session
//     can never sit beside "still asking" or beside "unreachable".
//   - `signIn`: the login screen's own button.

/** The answer to "who is signed in": still asking, told, or could not ask.
 * "Still asking" vs "asked, and you are logged out" is what keeps the login
 * screen from flashing over an already-authenticated Cockpit. `unreachable`
 * (`/auth/session` itself failed) is a different problem from being logged
 * out, and is shown differently. */
export type SessionLoad =
  | { status: 'loading' }
  | { status: 'ready'; session: AuthSession }
  | { status: 'unreachable'; message: string };

/** In-flight state of the login screen's button. */
export type SignInState =
  | { status: 'idle' }
  | { status: 'signing-in' }
  | { status: 'failed'; message: string };

export type AuthSessionState = {
  load: SessionLoad;
  signIn: SignInState;
};

export type AuthSessionAction =
  | { type: 'LOAD_START' }
  | { type: 'LOADED'; session: AuthSession }
  | { type: 'LOAD_FAILED'; message: string }
  | { type: 'SIGN_IN_START' }
  | { type: 'SIGN_IN_FAILED'; message: string };

export const initialAuthSessionState: AuthSessionState = {
  load: { status: 'loading' },
  signIn: { status: 'idle' },
};

/** A sign-in that is still in flight ends when the session answer lands (either way); a failure stays
 * on the login screen until the next attempt starts. */
const settleSignIn = (signIn: SignInState): SignInState => (signIn.status === 'signing-in' ? { status: 'idle' } : signIn);

export function authSessionReducer(state: AuthSessionState, action: AuthSessionAction): AuthSessionState {
  switch (action.type) {
    case 'LOAD_START':
      // A previous answer is dropped while asking again: until it lands, nothing is known.
      return { ...state, load: { status: 'loading' } };
    case 'LOADED':
      return { load: { status: 'ready', session: action.session }, signIn: settleSignIn(state.signIn) };
    case 'LOAD_FAILED':
      // Deliberately does NOT keep a previously-good session: if the server
      // has become unreachable we do not know whether the gate still holds,
      // and `blocksCockpit(null)` treats not knowing as blocked.
      return { load: { status: 'unreachable', message: action.message }, signIn: settleSignIn(state.signIn) };
    case 'SIGN_IN_START':
      return { ...state, signIn: { status: 'signing-in' } };
    case 'SIGN_IN_FAILED':
      return { ...state, signIn: { status: 'failed', message: action.message } };
    default:
      return state;
  }
}

/** The session once the server has answered; null while asking or when it could not be reached. */
export const sessionOf = (state: AuthSessionState): AuthSession | null => (state.load.status === 'ready' ? state.load.session : null);

/** True until the first (or a repeated) `/auth/session` answer lands. */
export const isLoadingSession = (state: AuthSessionState): boolean => state.load.status === 'loading';

/** Why `/auth/session` could not be reached; null otherwise. */
export const unreachableMessage = (state: AuthSessionState): string | null => (state.load.status === 'unreachable' ? state.load.message : null);

/** True while the login screen's own button is in flight. */
export const isSigningIn = (state: AuthSessionState): boolean => state.signIn.status === 'signing-in';

/** The last sign-in failure, for the login screen; null when there is none. */
export const signInError = (state: AuthSessionState): string | null => (state.signIn.status === 'failed' ? state.signIn.message : null);
