import type { ReactNode } from 'react';
import { LoadingState } from '@/features/states';
import { LoginScreen } from '../components/LoginScreen';
import type { AuthSession } from '../types';

type AuthGatePageProps = {
  session: AuthSession | null;
  loading: boolean;
  unreachable: string | null;
  signingIn: boolean;
  error: string | null;
  blocked: boolean;
  canSignIn: boolean;
  onSignInWithGithub: () => void;
  onSignInAsTestUser: () => void;
  onRetry: () => void;
  tagline: string;
  taglineAnimated: boolean;
  /** #406: true for the short beat after a real, in-tab sign-in (blocked flips true -> false while
   * this screen was actually on screen) while the mark plays its exit hand-off. See
   * AuthGateController.tsx for how this is derived — never true on an ordinary already-signed-in
   * page load, only on a transition this tab witnessed. */
  handoff: boolean;
  onHandoffEnd: () => void;
  children: ReactNode;
};

// Presentation-only routing between the four possible states (PAGE-002..005, #406 adds the
// hand-off): still asking, blocked, handing off, or through. No application-layer imports and no
// literal network call.
export function AuthGatePage({
  session,
  loading,
  unreachable,
  signingIn,
  error,
  blocked,
  canSignIn,
  onSignInWithGithub,
  onSignInAsTestUser,
  onRetry,
  tagline,
  taglineAnimated,
  handoff,
  onHandoffEnd,
  children,
}: AuthGatePageProps): ReactNode {
  // "Still asking" is its own state, not a flash of the login screen over a
  // Cockpit the person is in fact signed in to.
  if (loading) {
    return (
      // `auth-screen` is not decoration here: this branch also replaces the
      // whole Cockpit frame, and `.app` is a flex row, so without it the
      // card jams into the top-left corner with its border clipped. This is
      // the first frame of every page load on a gated server.
      <main className="page page--screen auth-screen">
        {/* #406: the shared AnimatedLoader (same brand mark, faster loop) instead of the generic
            `.st-spinner` — the one real drop-in site this ticket wires up. */}
        <LoadingState label="Checking your session" hint="Asking the Cockpit server whether this machine is signed in." animated />
      </main>
    );
  }
  if (blocked) {
    return (
      <LoginScreen
        tagline={tagline}
        taglineAnimated={taglineAnimated}
        session={session}
        unreachable={unreachable}
        signingIn={signingIn}
        error={error}
        canSignIn={canSignIn}
        onSignInWithGithub={onSignInWithGithub}
        onSignInAsTestUser={onSignInAsTestUser}
        onRetry={onRetry}
      />
    );
  }
  if (handoff) {
    // #406: the Cockpit (`children`) is already mounted here, underneath — the login screen is a
    // fixed, fading overlay above it (`auth-screen--handoff`, app/brand.css) rather than the only
    // thing on screen, so there is no blank frame between the two.
    return (
      <>
        {children}
        <LoginScreen
          tagline={tagline}
          taglineAnimated={taglineAnimated}
          session={session}
          unreachable={unreachable}
          signingIn={signingIn}
          error={error}
          canSignIn={canSignIn}
          onSignInWithGithub={onSignInWithGithub}
          onSignInAsTestUser={onSignInAsTestUser}
          onRetry={onRetry}
          exiting
          onExitEnd={onHandoffEnd}
        />
      </>
    );
  }
  return children;
}
