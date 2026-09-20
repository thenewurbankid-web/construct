import type { AuthUser } from '../types';

// How a signed-in account is labelled. Split from Session.ts for
// MODULE-001 (one primary module per file) — these two are about
// presentation of an account, not about whether the gate holds.

/** Show the person's name when GitHub gave us one, otherwise their login. */
export function displayName(user: AuthUser | null): string {
  if (!user) return '';
  const name = user.name?.trim();
  return name || user.login;
}

/** Fallback avatar when GitHub gave us no picture (always the case for the
 * test login): the first character of the login, uppercased. */
export function initial(user: AuthUser | null): string {
  const login = user?.login?.trim() ?? '';
  return login ? login[0].toUpperCase() : '?';
}
