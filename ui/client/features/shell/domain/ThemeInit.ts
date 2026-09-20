// Pure (DOMAIN-001): the pre-paint theme bootstrap.
export const THEME_STORAGE_KEY = 'construct.theme';

/** Inline script run in <head> BEFORE first paint so a stored light theme
 * never flashes dark. Self-contained (no imports), guarded, and it only ever
 * writes a validated value to the data-theme attribute. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var l=t==='light'||(t==='system'&&window.matchMedia('(prefers-color-scheme: light)').matches);document.documentElement.setAttribute('data-theme',l?'light':'dark')}catch(e){document.documentElement.setAttribute('data-theme','dark')}`;
