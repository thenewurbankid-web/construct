// Thin HTTP-shaped adapter over src/dir-browser.mjs (all listing/allowlist/
// symlink logic lives in core, reusable and tested there). This layer only:
// origin-guards the request, parses the query string, and maps
// DirBrowseError.status to a response. Pure function (no express) so it is
// unit-testable without a socket.
import { listDirectories, normalizeRoots, DirBrowseError } from '../../../packages/core/dir-browser.mjs';
import { contain, WorkspaceError } from './workspace.mjs';

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
    // #365: a relative `path` means workspace-relative (never process.cwd()), and the path is contained by
    // realpath here first, so a symlink or `..` out of the root is a 403 before anything is listed.
    // #568: "My projects" is ONE level: the workspace root itself. A `path` is accepted only when it names that
    // root (so an old client still works); any other spelling, even one inside the workspace, is the same 403 as
    // an outside path. Hidden folders are never listed, and no entry carries a way to navigate deeper.
    let requested = q.path;
    if (typeof requested === 'string' && requested !== '' && Array.isArray(roots) && roots.length > 0) {
      let firstError = null;
      let contained = null;
      for (const root of roots) {
        try {
          contained = contain(root, requested, { mustBeDir: true });
          break;
        } catch (e) {
          if (!(e instanceof WorkspaceError)) throw e;
          firstError ??= e;
        }
      }
      if (contained === null) return { status: firstError.status, body: { ok: false, code: firstError.code, error: firstError.message } };
      if (!normalizeRoots(roots).includes(contained)) {
        return { status: 403, body: { ok: false, code: 'OUTSIDE_WORKSPACE', error: 'That path is outside the workspace.' } };
      }
      requested = contained;
    }
    const result = listDirectories({
      path: requested,
      roots,
      showHidden: false,
      limit: q.limit,
      offset: q.offset,
    });
    return { status: 200, body: { ok: true, ...result } };
  } catch (e) {
    if (e instanceof DirBrowseError) return { status: e.status, body: { ok: false, error: e.message } };
    return { status: 500, body: { ok: false, error: 'Could not list directory.' } };
  }
}
