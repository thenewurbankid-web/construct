import { API_BASE } from './apiBase';

// Shared, non-feature POST-JSON helper (see apiBase.ts for why this lives
// outside features/) — every feature's service/ layer that talks to
// ui/server's REST endpoints uses this instead of each hand-rolling the
// same fetch/JSON-parse/`{}`-on-failure boilerplate.
export async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
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
  const res = await fetch(`${API_BASE}${path}`);
  return res.json() as Promise<T>;
}
