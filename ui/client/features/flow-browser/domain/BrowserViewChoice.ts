import type { BrowserView } from '../types.ts';

/** Storage key for one project's Browser view (`null` = project not known yet). */
export const browserViewKey = (projectDir: string | null): string => `construct.browser.view:${projectDir ?? '(default)'}`;

/** Files is the default; anything unrecognised in storage falls back to it. */
export const sanitizeBrowserView = (raw: unknown): BrowserView => (raw === 'flow' ? 'flow' : 'files');
