import { withOpenPage, type OpenPageTarget } from '../domain/OpenPage';

/** Keeps the open page in the URL (?feature=&file=) so a reload or a shared link opens the same page; null clears it.
 * `replaceState`: no new history entry and no navigation. */
export function writeOpenPageUrl(target: OpenPageTarget | null): void {
  const search = withOpenPage(window.location.search, target);
  window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
}
