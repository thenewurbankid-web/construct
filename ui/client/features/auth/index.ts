// Public API for feature: auth

/** Session and signed-in-user types, mirroring ui/server's GET /auth/session. */
export type * from './types';

/** One shared session fetch for the tab, plus the sign-in/sign-out actions. Mount once, above the shell. */
export * from './hooks/useAuthSession';

/** State and actions of the top bar's account chip. */
export * from './hooks/useUserMenu';

/** Replaces the whole Cockpit with a login screen when this browser has no session. */
export * from './controllers/AuthGateController';

/** The signed-in account (avatar + Sign out) for the top bar; renders nothing when there is no gate. */
export * from './controllers/UserMenuController';

/** Pure predicates over a session — whether the Cockpit is blocked, whether
 * there is any way to sign in, and whether an account chip belongs in the bar. */
export * from './domain/Session';

/** How a signed-in account is labelled (display name, avatar fallback). */
export * from './domain/UserLabel';
