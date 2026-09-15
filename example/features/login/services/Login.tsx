// Session persistence is an external effect (browser storage), so it lives in
// a service, not domain or the workflow (per architecture.yml's SERVICE-001).
const SESSION_KEY = 'construct-demo-session';

export function startSession(username: string): void {
  window.localStorage.setItem(SESSION_KEY, username);
}

export function getSessionUser(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function endSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}
