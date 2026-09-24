import { API_BASE } from './apiBase';

// Shared, non-feature POST-JSON helper (see apiBase.ts for why this lives
// outside features/) — every feature's service/ layer that talks to
// ui/server's REST endpoints uses this instead of each hand-rolling the
// same fetch/JSON-parse/`{}`-on-failure boilerplate.
// #278: `credentials: 'include'` on every call. The session cookie is set
// by ui/server on :4000 and the Cockpit is served from :3000 — a different
// origin — so without this the browser sends no cookie and every request
// from a signed-in user comes back 401. It belongs here, once, rather than
// in each feature's service/ layer: a feature that forgot it would look
// logged out for no discoverable reason.
export async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

export async function getJson<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  return res.json() as Promise<T>;
}

// #596: any verb with any headers, answering `{ status, body }` instead of throwing on a non-2xx. Notes need it: a
// stale write is a 409 whose body is the copy to compare, and a full disk is a 507 the screen shows with Retry.
export async function sendJson<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: unknown = {};
  try {
    parsed = await res.json();
  } catch {
    /* an empty or non-JSON body is `{}` here, like postJson */
  }
  return { status: res.status, body: parsed as T };
}
