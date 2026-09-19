import { OPEN_PAGE_EVENT, parseOpenPage, type OpenPageTarget } from '../domain/OpenPage';

/** Asks an already-mounted Pages editor to open a page file. */
export function requestOpenPage(target: OpenPageTarget): void {
  window.dispatchEvent(new CustomEvent<OpenPageTarget>(OPEN_PAGE_EVENT, { detail: target }));
}

/** Calls `onOpen` for the page named in the URL at load time (if any) and for later requests. Returns an unsubscribe. */
export function subscribeOpenPage(onOpen: (target: OpenPageTarget) => void): () => void {
  const initial = parseOpenPage(window.location.search);
  if (initial) onOpen(initial);
  const handler = (e: Event) => onOpen((e as CustomEvent<OpenPageTarget>).detail);
  window.addEventListener(OPEN_PAGE_EVENT, handler);
  return () => window.removeEventListener(OPEN_PAGE_EVENT, handler);
}
