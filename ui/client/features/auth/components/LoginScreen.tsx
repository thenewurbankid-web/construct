'use client';

import { Button, GlassPanel } from '@/components/ui';
import type { AuthSession } from '../types';

type LoginScreenProps = {
  session: AuthSession | null;
  /** Set when `/auth/session` itself could not be reached. */
  unreachable: string | null;
  signingIn: boolean;
  error: string | null;
  canSignIn: boolean;
  onSignInWithGithub: () => void;
  onSignInAsTestUser: () => void;
  onRetry: () => void;
};

/**
 * The whole screen when this browser has no session — it replaces the
 * Cockpit frame rather than appearing inside it, because there is nothing
 * behind it that would work: every `/api/*` call answers 401 and the wizard
 * WebSocket upgrade is refused (ui/server/src/auth.mjs).
 *
 * Presentation only (COMPONENT-*): no fetch, no application state.
 */
export function LoginScreen({
  session,
  unreachable,
  signingIn,
  error,
  canSignIn,
  onSignInWithGithub,
  onSignInAsTestUser,
  onRetry,
}: LoginScreenProps) {
  return (
    <div className="page page--screen auth-screen" data-testid="login-screen">
      <GlassPanel className="gate-panel">
        <h1>Sign in to the Cockpit</h1>
        {unreachable ? (
          <>
            <p className="hint">{unreachable}</p>
            <Button onClick={onRetry}>Try again</Button>
          </>
        ) : (
          <>
            <p className="hint">
              This Cockpit runs Construct commands, browses the filesystem and writes source files in
              your project, so it is only usable by an account its owner has allowed.
            </p>
            {canSignIn ? (
              <div className="auth-actions">
                {session?.githubConfigured && (
                  <Button onClick={onSignInWithGithub} disabled={signingIn} data-testid="login-github">
                    {signingIn ? 'Signing in…' : 'Sign in with GitHub'}
                  </Button>
                )}
                {session?.testLogin && (
                  <Button
                    onClick={onSignInAsTestUser}
                    disabled={signingIn}
                    data-testid="login-test-user"
                    className="auth-test-login"
                  >
                    {signingIn ? 'Signing in…' : `Sign in as ${session.testLoginUser} (test login)`}
                  </Button>
                )}
              </div>
            ) : (
              <p className="status-error" data-testid="login-unconfigured">
                This server requires a login but has no GitHub OAuth app configured, so there is no way
                to sign in. Set CONSTRUCT_GITHUB_CLIENT_ID, CONSTRUCT_GITHUB_CLIENT_SECRET and
                CONSTRUCT_ALLOWED_LOGINS on the server, then restart it.
              </p>
            )}
            {session?.testLogin && (
              <p className="hint auth-test-note">
                A test login is enabled on this server. It exists for the end-to-end suite, is refused
                under NODE_ENV=production and off loopback, and should not be set on a shared machine.
              </p>
            )}
            {error && <p className="status-error">{error}</p>}
          </>
        )}
      </GlassPanel>
    </div>
  );
}
