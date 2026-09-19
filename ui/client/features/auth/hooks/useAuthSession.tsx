'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { fetchSession, logout as logoutRequest } from '../services/AuthApi';
import { startGithubLogin, testLogin } from '../services/AuthLogin';
import { authSessionReducer, initialAuthSessionState, type AuthSessionState } from '../workflows/AuthSession';
import type { AuthSession } from '../types';

type AuthSessionValue = AuthSessionState & {
  refresh: () => void;
  signInWithGithub: () => void;
  signInAsTestUser: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

/**
 * One session fetch for the whole app, shared by the gate and the top bar's
 * user menu — unlike project-gate (which each gated route mounts for
 * itself), there is exactly one answer to "who is signed in" per browser
 * tab, and two components need it at once.
 *
 * Mounted in the root layout above ShellController, so the login screen can
 * replace the entire Cockpit frame rather than appearing inside it.
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authSessionReducer, initialAuthSessionState);

  const refresh = useCallback(() => {
    dispatch({ type: 'LOAD_START' });
    fetchSession()
      .then((session: AuthSession) => dispatch({ type: 'LOADED', session }))
      .catch(() =>
        dispatch({
          type: 'LOAD_FAILED',
          message: 'The Cockpit server did not answer. Check that it is running, then try again.',
        }),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signInWithGithub = useCallback(() => {
    dispatch({ type: 'SIGN_IN_START' });
    startGithubLogin(state.session?.loginPath ?? '/auth/login');
  }, [state.session?.loginPath]);

  const signInAsTestUser = useCallback(async () => {
    dispatch({ type: 'SIGN_IN_START' });
    const result = await testLogin().catch(() => ({ ok: false, error: 'The test login could not be reached.' }));
    if (!result.ok) {
      dispatch({ type: 'SIGN_IN_FAILED', message: result.error ?? 'The test login was refused.' });
      return;
    }
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await logoutRequest().catch(() => undefined);
    refresh();
  }, [refresh]);

  const value = useMemo<AuthSessionValue>(
    () => ({ ...state, refresh, signInWithGithub, signInAsTestUser, signOut }),
    [state, refresh, signInWithGithub, signInAsTestUser, signOut],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

/** Current session plus the sign-in/sign-out actions. Throws outside the
 * provider rather than silently reporting "logged out", which would be a
 * security-shaped lie in a component that decides what to render. */
export function useAuthSession(): AuthSessionValue {
  const value = useContext(AuthSessionContext);
  if (!value) throw new Error('useAuthSession must be used inside <AuthSessionProvider>');
  return value;
}
