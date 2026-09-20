import { browserViewKey, sanitizeBrowserView } from '../domain/BrowserViewChoice';
import type { BrowserView } from '../types';

/** Reads one project's remembered Browser view; guarded (storage can throw or hold garbage). */
export function loadBrowserView(projectKey: string | null): BrowserView {
  try {
    return sanitizeBrowserView(window.localStorage.getItem(browserViewKey(projectKey)));
  } catch {
    return 'files';
  }
}

export function saveBrowserView(projectKey: string | null, view: BrowserView): void {
  try {
    window.localStorage.setItem(browserViewKey(projectKey), view);
  } catch {
    /* remembering the choice is a convenience, not required */
  }
}
