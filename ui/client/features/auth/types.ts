export type AuthId = string;

/** The signed-in GitHub account, as `/auth/session` reports it. */
export type AuthUser = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * Shape returned by ui/server's public `GET /auth/session`
 * (see ui/server/src/auth.mjs) — the single source of truth for whether
 * this Cockpit requires a login and whether this browser has one.
 *
 * `authRequired: false` is the honest answer for an unauthenticated
 * loopback run (the default for local development): there is no gate, and
 * the Cockpit renders directly. It is never `false` when the server is
 * bound off loopback — the server refuses to start in that combination.
 */
export type AuthSession = {
  authRequired: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  /** Whether a GitHub OAuth app is configured, i.e. whether `loginPath` works. */
  githubConfigured: boolean;
  loginPath: string;
  /** Whether the e2e test login endpoint is enabled on this server. */
  testLogin: boolean;
  testLoginUser: string | null;
};
