import { getJson } from '@/lib/http';
import type { BrowseFailure, RawDirListing } from '../types';

/** Real network I/O for the picker — one thin wrapper over ui/server's
 * GET /api/fs/browse (allowlisted, directories-only). Failures come back as
 * `{ ok: false, error }` (400/403/404 from the server), never thrown. */
export async function browseDirectory(opts: {
  path?: string;
  showHidden?: boolean;
  offset?: number;
}): Promise<RawDirListing | BrowseFailure> {
  const params = new URLSearchParams();
  if (opts.path) params.set('path', opts.path);
  if (opts.showHidden) params.set('showHidden', 'true');
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  try {
    return await getJson<RawDirListing | BrowseFailure>(`/api/fs/browse${qs ? `?${qs}` : ''}`);
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}
