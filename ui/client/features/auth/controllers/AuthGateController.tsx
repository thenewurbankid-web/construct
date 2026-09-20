'use client';

import type { ReactNode } from 'react';
import { blocksCockpit, canSignIn } from '../domain/Session';
import { useAuthSession } from '../hooks/useAuthSession';
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
  const { session, loading, unreachable, signingIn, error, refresh, signInWithGithub, signInAsTestUser } = useAuthSession();
  return (
    <AuthGatePage
      session={session}
      loading={loading}
      unreachable={unreachable}
      signingIn={signingIn}
      error={error}
      blocked={blocksCockpit(session)}
      canSignIn={canSignIn(session)}
      onSignInWithGithub={signInWithGithub}
      onSignInAsTestUser={() => void signInAsTestUser()}
      onRetry={refresh}
    >
      {children}
    </AuthGatePage>
  );
}
