'use client';

import { Button, GlassPanel, Logo } from '@/components/ui';
import type { AuthSession } from '../types';
import { LoginBackdrop } from './LoginBackdrop';

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
  /** The typed, changing tagline shown above the card. */
  tagline: string;
  /** False under reduced motion: no caret. */
  taglineAnimated: boolean;
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
  tagline,
  taglineAnimated,
}: LoginScreenProps) {
  return (
    // <main> because the shell — which normally supplies the page's
    // landmarks — has been replaced entirely; without it the document has
    // none at all.
    <main className="page page--screen auth-screen" data-testid="login-screen">
      <LoginBackdrop />
      <div className="login-brand" data-testid="login-brand">
        <Logo mark="cockpit" size={36} />
        <span>Cockpit</span>
      </div>
      <p className="login-tagline" data-testid="login-tagline" aria-hidden="true">
        <span>{tagline}</span>
        {taglineAnimated && <span className="login-tagline__caret" />}
      </p>
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
                {/* Deliberately `ghost`: the test login must not read as an
                    equally legitimate path next to the real one. An opacity
                    nudge was invisible; the lower-emphasis variant is not. */}
                {session?.testLogin && (
                  <Button variant="ghost" onClick={onSignInAsTestUser} disabled={signingIn} data-testid="login-test-user">
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
            {/* role="alert" so a refused sign-in is announced, not silent —
                the same idiom ProjectSwitcher already uses. */}
            {error && (
              <p className="status-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </GlassPanel>
    </main>
  );
}
