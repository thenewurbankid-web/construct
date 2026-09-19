import { API_BASE } from '@/lib/apiBase';
import type { AuthSession } from '../types';

/**
 * Real network I/O for the session itself (SERVICE-*); the two ways of
 * *starting* a login live in AuthLogin.ts.
 *
 * Every call here is credentialed: the session cookie is set by ui/server
 * on :4000 and the Cockpit is served from :3000, so without
 * `credentials: 'include'` the browser sends no cookie and a logged-in user
 * looks logged out.
 *
 * The two ports are the same *site* (`localhost`), which is why a
 * `SameSite=Lax` cookie travels between them at all — see the note in
 * ui/server/src/auth.mjs about serving client and server from the same site
 * when this is deployed anywhere other than a developer's machine.
 */
export async function fetchSession(): Promise<AuthSession> {
  const res = await fetch(`${API_BASE}/auth/session`, { credentials: 'include' });
  return res.json() as Promise<AuthSession>;
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
}
