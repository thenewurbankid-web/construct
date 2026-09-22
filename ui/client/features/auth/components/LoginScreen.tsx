'use client';

import { AnimatedLoader, AnimatedLogo, Button } from '@/components/ui';
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
  /** #406: true for the short beat after a real sign-in where this screen is still mounted (as a
   * fixed overlay — see AuthGatePage.tsx) so the mark's exit hand-off can play before it is removed.
   * Not set on the ordinary "signed out" render, so the class/prop below is a no-op by default. */
  exiting?: boolean;
  /** #406: fires once the hand-off finishes (or immediately under reduced motion). Only meaningful
   * together with `exiting`. */
  onExitEnd?: () => void;
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
  exiting = false,
  onExitEnd,
}: LoginScreenProps) {
  return (
    // <main> because the shell — which normally supplies the page's
    // landmarks — has been replaced entirely; without it the document has
    // none at all.
    // #406: `auth-screen--handoff` only while `exiting` — it lifts this screen out of flow into a
    // fixed, fading overlay above the Cockpit AuthGatePage has already mounted underneath it.
    <main className={exiting ? 'page page--screen auth-screen auth-screen--handoff' : 'page page--screen auth-screen'} data-testid="login-screen">
      <LoginBackdrop />
      {/* Owner request, 2026-09-21: two rows — the mark alone and large on the first, the wordmark
          centred under it. The size below is only the intrinsic one; `.login-brand__mark` scales it
          fluidly with clamp() so it fits a 390px phone (app/brand.css). */}
      <div className="login-brand login-brand--stacked" data-testid="login-brand">
        <AnimatedLogo mark="cockpit" size={112} className="login-brand__mark" exiting={exiting} onExitEnd={onExitEnd} />
        <span className="login-brand__word">Cockpit</span>
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
                    {/* #406: `decorative` — the button's own text ("Signing in…") is already the
                        accessible name, so the loader adds no separate announcement. */}
                    {signingIn ? <AnimatedLoader size="small" variant="inline" decorative /> : <GithubMark />}
                    <span>{signingIn ? 'Signing in…' : 'Sign in with GitHub'}</span>
                  </button>
                )}
                {/* Same geometry as the GitHub button but outlined, not filled: the
                    test login must not read as an equally legitimate path. */}
                {session?.testLogin && (
                  <>
                    <button type="button" className="gh-signin gh-signin--test" onClick={onSignInAsTestUser} disabled={signingIn} data-testid="login-test-user">
                      {signingIn && <AnimatedLoader size="small" variant="inline" decorative />}
                      {signingIn ? 'Signing in…' : `Sign in as ${session.testLoginUser} (test login)`}
                    </button>
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
