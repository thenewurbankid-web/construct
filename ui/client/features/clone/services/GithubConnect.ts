import { API_BASE } from '@/lib/apiBase';

// Real navigation for the GitHub connection (#638, SERVICE-*): the consent is a full-page hop to GitHub and back.

/** Where the browser goes to start the connection (a full-page hop to GitHub and back, so the address is a navigation, not a fetch). */
export const githubConnectUrl = (): string => `${API_BASE}/auth/repo/start`;

/** Send the browser to GitHub to grant the connection. It comes back to the Cockpit's own address. */
export function startGithubConnect(): void {
  window.location.assign(githubConnectUrl());
}
