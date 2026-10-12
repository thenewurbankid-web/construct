// Two modes: one signal that the selection kept in the URL changed (history.replaceState fires no event of its own).
// Writers of a URL selection announce it; the chat listens, so its breadcrumb follows a pick made Under the hood.
export const PLACE_EVENT = 'cockpit:place';

/** Tell listeners the URL's selection changed (call right after history.replaceState). */
export function announcePlace(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLACE_EVENT));
}
