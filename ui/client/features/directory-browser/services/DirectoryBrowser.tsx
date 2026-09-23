import { getJson } from '@/lib/http';
import type { BrowseFailure, RawDirListing } from '../types';

/** Real network I/O for the project list: one thin wrapper over ui/server's GET /api/fs/browse, which lists
 * only the signed-in user's own workspace (one level, directories only; #568). Failures come back as
 * `{ ok: false, error }`, never thrown. */
export async function browseDirectory(opts: { offset?: number } = {}): Promise<RawDirListing | BrowseFailure> {
  const qs = opts.offset ? `?offset=${opts.offset}` : '';
  try {
    return await getJson<RawDirListing | BrowseFailure>(`/api/fs/browse${qs}`);
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}
