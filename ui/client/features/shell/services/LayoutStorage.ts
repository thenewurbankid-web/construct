import { DEFAULT_LAYOUT } from '../domain/LayoutDefaults.ts';
import { layoutStorageKey, sanitizeLayout } from '../domain/LayoutState.ts';
import type { ShellLayoutState } from '../types.ts';

/** Reads one project's saved layout; guarded (storage can throw or hold garbage). */
export function loadLayout(projectDir: string | null): ShellLayoutState {
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(projectDir));
    return raw ? sanitizeLayout(JSON.parse(raw)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(projectDir: string | null, layout: ShellLayoutState): void {
  try {
    window.localStorage.setItem(layoutStorageKey(projectDir), JSON.stringify(layout));
  } catch {
    /* persistence is a convenience, not required */
  }
}
