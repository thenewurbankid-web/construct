'use client';

import { Button, Logo } from '@/components/ui';
import type { AuthSession } from '../types';
import { LoginBackdrop } from './LoginBackdrop';
import { GithubMark } from './GithubMark';

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
        <Logo mark="cockpit" size={64} />
        <span>Cockpit</span>
      </div>
      <p className="login-tagline" data-testid="login-tagline" aria-hidden="true">
        <span>{tagline}</span>
        {taglineAnimated && <span className="login-tagline__caret" />}
      </p>
      <div className="login-actions">
        <h1 className="sr-only">Sign in to the Cockpit</h1>
        {unreachable ? (
          <>
            <p className="hint login-note">{unreachable}</p>
            <Button onClick={onRetry}>Try again</Button>
          </>
        ) : (
          <>
            {canSignIn ? (
              <>
                {session?.githubConfigured && (
                  <button type="button" className="gh-signin" onClick={onSignInWithGithub} disabled={signingIn} data-testid="login-github">
                    <GithubMark />
                    <span>{signingIn ? 'Signing in…' : 'Sign in with GitHub'}</span>
                  </button>
                )}
                {/* Deliberately `ghost`: the test login must not read as an
                    equally legitimate path next to the real one. */}
                {session?.testLogin && (
                  <>
                    <Button variant="ghost" onClick={onSignInAsTestUser} disabled={signingIn} data-testid="login-test-user">
                      {signingIn ? 'Signing in…' : `Sign in as ${session.testLoginUser} (test login)`}
                    </Button>
                    {/* Only ever rendered on an e2e server: the hatch says what it is rather than hiding. */}
                    <p className="hint login-note login-note--test">
                      Test login: for the end-to-end suite only; refused under NODE_ENV=production and off loopback.
                    </p>
                  </>
                )}
              </>
            ) : (
              <p className="status-error login-note" data-testid="login-unconfigured">
                This server requires a login but has no GitHub OAuth app configured, so there is no way
                to sign in. Set CONSTRUCT_GITHUB_CLIENT_ID, CONSTRUCT_GITHUB_CLIENT_SECRET and
                CONSTRUCT_ALLOWED_LOGINS on the server, then restart it.
              </p>
            )}
            {/* role="alert" so a refused sign-in is announced, not silent —
                the same idiom ProjectSwitcher already uses. */}
            {error && (
              <p className="status-error login-note" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
