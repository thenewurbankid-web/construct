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
  children: ReactNode;
};

// Presentation-only routing between the three possible states
// (PAGE-002..005): still asking, blocked, or through. No application-layer
// imports and no literal network call.
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
        <LoadingState label="Checking your session" hint="Asking the Cockpit server whether this machine is signed in." />
      </main>
    );
  }
  if (blocked) {
    return (
      <LoginScreen
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
  return children;
}
