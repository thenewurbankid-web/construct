// Pure (DOMAIN-001): what the Cockpit frame shows for the state of the open project. With NO project open the
// whole UI is blocked behind the full-screen "Open a project" gate (no rail, panes, drawer or palette); only
// the pages reached from the profile menu (Settings, Local model, Help) stay usable as full pages, because
// choosing the project folder and fixing the model both have to work before a project exists.

import type { ShellMode } from '../types.ts';

/** Routes that do not need a project. Everything else shows the gate. */
export const PROJECT_FREE_ROUTES = ['/settings', '/ollama', '/help'];

export function isProjectFreeRoute(pathname: string): boolean {
  return PROJECT_FREE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export function shellMode(known: boolean, projectDir: string | null, pathname: string): ShellMode {
  if (!known) return 'loading';
  if (projectDir) return 'full';
  return isProjectFreeRoute(pathname) ? 'page' : 'gate';
}
