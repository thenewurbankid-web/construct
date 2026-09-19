// Thin HTTP-shaped adapter over src/dir-browser.mjs (all listing/allowlist/
// symlink logic lives in core, reusable and tested there). This layer only:
// origin-guards the request, parses the query string, and maps
// DirBrowseError.status to a response. Pure function (no express) so it is
// unit-testable without a socket.
import { listDirectories, DirBrowseError } from '../../../src/dir-browser.mjs';

/**
 * @param {{path?:string, showHidden?:string, limit?:string, offset?:string}} query
 * @param {{origin?:string, clientOrigin:string, roots:string[]}} ctx
 * @returns {{status:number, body:object}}
 */
export function handleBrowse(query, { origin, clientOrigin, roots }) {
  // A browser sends Origin on cross-origin requests; refuse any that is not
  // the configured UI client. (No Origin = same-origin/non-browser tool such
  // as curl on the host, which can read the disk directly anyway.)
  if (origin && origin !== clientOrigin) {
    return { status: 403, body: { ok: false, error: 'Origin not allowed.' } };
  }
  const q = query || {};
  if (q.path !== undefined && typeof q.path !== 'string') {
    return { status: 400, body: { ok: false, error: 'path must be a single string.' } };
  }
  try {
    const result = listDirectories({
      path: q.path,
      roots,
      showHidden: q.showHidden === 'true' || q.showHidden === '1',
      limit: q.limit,
      offset: q.offset,
    });
    return { status: 200, body: { ok: true, ...result } };
  } catch (e) {
    if (e instanceof DirBrowseError) return { status: e.status, body: { ok: false, error: e.message } };
    return { status: 500, body: { ok: false, error: 'Could not list directory.' } };
  }
}
