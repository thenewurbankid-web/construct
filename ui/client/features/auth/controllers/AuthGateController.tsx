'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { blocksCockpit, canSignIn } from '../domain/Session';
import { LOGIN_PHRASES } from '../domain/Typewriter';
import { useTypewriter } from '../hooks/useTypewriter';
import { useAuthSession } from '../hooks/useAuthSession';
import { isLoadingSession, isSigningIn, signInError, unreachableMessage } from '../workflows/AuthSession';
import { AuthGatePage } from '../pages/AuthGatePage';

/**
 * Wraps the entire Cockpit and replaces it with a login screen when this
 * browser has no session.
 *
 * This is the *convenience* half of #278, not the enforcement. ui/server
 * answers 401 on every `/api/*` route and refuses the `/ws/wizard` upgrade
 * whatever this renders — a UI-only gate was explicitly ruled out, because
 * the API is the attack surface, not the React tree. What this buys is a
 * Cockpit that says "sign in" instead of one that renders its panes and
 * then fails every request inside them.
 */
export function AuthGateController({ children }: { children: ReactNode }) {
  const { state, session, refresh, signInWithGithub, signInAsTestUser } = useAuthSession();
  const loading = isLoadingSession(state);
  const unreachable = unreachableMessage(state);
  const signingIn = isSigningIn(state);
  const error = signInError(state);
  const { text: tagline, animated: taglineAnimated } = useTypewriter(LOGIN_PHRASES);
  const blocked = blocksCockpit(session);

  // #406: a real sign-in witnessed in THIS tab (the login screen was actually on screen, then
  // resolved to unblocked) gets a brief hand-off instead of an instant cut. `shownLogin` — not just
  // "was blocked" — is what keeps an ordinary already-signed-in page load (which never renders the
  // login screen at all; `loading` is true the whole time until it resolves straight to unblocked)
  // from triggering it: there is nothing on screen to hand off from in that case.
  const shownLogin = useRef(false);
  const [handoff, setHandoff] = useState(false);
  useEffect(() => {
    if (loading) return;
    if (blocked) {
      shownLogin.current = true;
      return;
    }
    if (shownLogin.current) {
      setHandoff(true);
      shownLogin.current = false;
    }
  }, [loading, blocked]);
  const onHandoffEnd = useCallback(() => setHandoff(false), []);

  return (
    <AuthGatePage
      tagline={tagline}
      taglineAnimated={taglineAnimated}
      session={session}
      loading={loading}
      unreachable={unreachable}
      signingIn={signingIn}
      error={error}
      blocked={blocked}
      handoff={handoff}
      onHandoffEnd={onHandoffEnd}
      canSignIn={canSignIn(session)}
      onSignInWithGithub={signInWithGithub}
      onSignInAsTestUser={() => void signInAsTestUser()}
      onRetry={refresh}
    >
      {children}
    </AuthGatePage>
  );
}
