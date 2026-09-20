import type { AuthSession } from '../types';

/**
 * Pure predicates over a session (DOMAIN-001: no effects here, ever).
 *
 * The important one is `blocksCockpit`. It is deliberately written so that
 * *not knowing* counts as blocked: a null session (the request has not
 * landed, or it failed) is not "probably fine", because the only reason
 * `/auth/session` fails is that the server is unreachable or refusing, and
 * neither is a state in which the Cockpit should render its panes as
 * though everything were normal.
 *
 * This is the client's half of the gate and it is *not* the enforcement —
 * ui/server answers 401 on every `/api/*` route and refuses the WebSocket
 * upgrade regardless of what this function returns. Deleting this file
 * would make the Cockpit ugly, not insecure.
 */
export function blocksCockpit(session: AuthSession | null): boolean {
  if (!session) return true;
  if (!session.authRequired) return false;
  return !session.authenticated;
}

/** Is there a login to offer at all? A server with the gate on but no OAuth
 * app and no test login configured cannot be logged into from the browser —
 * the login screen says so rather than showing a button that 503s. */
export function canSignIn(session: AuthSession | null): boolean {
  return Boolean(session && (session.githubConfigured || session.testLogin));
}

/** Whether the top bar should show an account at all. False on a server
 * with no gate (the unauthenticated loopback dev default): an empty account
 * chip there would imply a login that does not exist. */
export function showsAccount(session: AuthSession | null): boolean {
  return Boolean(session?.authRequired && session.user);
}
