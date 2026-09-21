// Pure (DOMAIN-001): a request to open one page file in the Pages editor
// (e.g. from a Diagnostics row), as a URL query or an in-page event.

export type OpenPageTarget = { feature: string; file: string };

/** Event name used when the editor is already on screen (a router push would not remount it). */
export const OPEN_PAGE_EVENT = 'construct:open-page';

/** `?feature=<f>&file=<path>` for the Pages editor route. */
export function openPageQuery(target: OpenPageTarget): string {
  return `?${new URLSearchParams({ feature: target.feature, file: target.file }).toString()}`;
}

/** The target encoded in a URL query string, or null when absent/incomplete. */
export function parseOpenPage(search: string): OpenPageTarget | null {
  const params = new URLSearchParams(search);
  const feature = params.get('feature');
  const file = params.get('file');
  return feature && file ? { feature, file } : null;
}

/** The query string after setting (or, with null, clearing) the open page; other params are kept. */
export function withOpenPage(search: string, target: OpenPageTarget | null): string {
  const params = new URLSearchParams(search);
  if (target) {
    params.set('feature', target.feature);
    params.set('file', target.file);
  } else {
    params.delete('feature');
    params.delete('file');
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
