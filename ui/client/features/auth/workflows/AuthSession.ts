import type { AuthSession } from '../types';

// Workflows own application state and flow but never import React
// (WORKFLOW-001) — a plain reducer, driven by the hook's useReducer.

export type AuthSessionState = {
  session: AuthSession | null;
  /** True until the first `/auth/session` answer lands. Distinguishing
   * "still asking" from "asked, and you are logged out" is what keeps the
   * login screen from flashing over an already-authenticated Cockpit. */
  loading: boolean;
  /** Set when `/auth/session` itself could not be reached — a different
   * problem from being logged out, and shown differently. */
  unreachable: string | null;
  /** In-flight state for the login screen's own button. */
  signingIn: boolean;
  error: string | null;
};

export type AuthSessionAction =
  | { type: 'LOAD_START' }
  | { type: 'LOADED'; session: AuthSession }
  | { type: 'LOAD_FAILED'; message: string }
  | { type: 'SIGN_IN_START' }
  | { type: 'SIGN_IN_FAILED'; message: string };

export const initialAuthSessionState: AuthSessionState = {
  session: null,
  loading: true,
  unreachable: null,
  signingIn: false,
  error: null,
};

export function authSessionReducer(state: AuthSessionState, action: AuthSessionAction): AuthSessionState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, unreachable: null };
    case 'LOADED':
      return { ...state, session: action.session, loading: false, unreachable: null, signingIn: false };
    case 'LOAD_FAILED':
      // Deliberately does NOT keep a previously-good session: if the server
      // has become unreachable we do not know whether the gate still holds,
      // and `blocksCockpit(null)` treats not knowing as blocked.
      return { ...state, session: null, loading: false, unreachable: action.message, signingIn: false };
    case 'SIGN_IN_START':
      return { ...state, signingIn: true, error: null };
    case 'SIGN_IN_FAILED':
      return { ...state, signingIn: false, error: action.message };
    default:
      return state;
  }
}
