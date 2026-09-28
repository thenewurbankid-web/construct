// What the matcher, the generator and the contract reader agree about an endpoint's PATH (`/api/x/:id`, `/a/:id/b/:sub`).
// One place, so "is this the item endpoint?" cannot mean two things (it used to be written in openapi.mjs and in match.mjs).
//
//   isItemPath(p)    the path ENDS in a parameter segment: `/x/:id`, and also `/a/:id/b/:sub` (the last segment decides)
//   pathParams(p)    the parameter names, in order
//   isWired(p)       true when the generator (src/emit.mjs) can call it: no parameter (list, create), or exactly one, the last
//                    segment (update, remove). It fills ONE `:param` in a URL and one capture in the mock route, so an endpoint
//                    with two parameters, or one that is not last, is imported and listed but never picked as the list, create,
//                    update or remove endpoint: generating a call to `/a/:id/b/:sub` with a literal `:sub` would be wrong code.
const PARAM = /:[A-Za-z_]+/g;

/**
 * The `:param` names in a path, in order.
 *
 * @param {string} p A path, e.g. `/a/:id/b/:sub`.
 * @returns {string[]} The parameter names without the leading `:`, e.g. `["id", "sub"]`.
 */
export const pathParams = (p) => (String(p).match(PARAM) ?? []).map((s) => s.slice(1));
/**
 * True when the path ends in a parameter segment (the last segment decides), e.g. `/x/:id` or `/a/:id/b/:sub`.
 *
 * @param {string} p A path.
 * @returns {boolean} Whether the last segment is a `:param`.
 */
export const isItemPath = (p) => /\/:[A-Za-z_]+$/.test(p);
/**
 * True when the generator (`src/emit.mjs`) can call this path: no parameter (list, create), or exactly one, and
 * it is the last segment (update, remove). A path with two parameters, or a parameter that is not last, is
 * imported and listed but never wired, since generating a call would need more than one filled `:param`.
 *
 * @param {string} p A path.
 * @returns {boolean} Whether the generator can wire a call to this path.
 */
export const isWired = (p) => { const n = pathParams(p).length; return n === 0 || (n === 1 && isItemPath(p)); };
