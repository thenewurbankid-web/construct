// What the matcher, the generator and the contract reader agree about an endpoint's PATH (`/api/x/:id`, `/a/:id/b/:sub`).
// One place, so "is this the item endpoint?" cannot mean two things (it used to be written in openapi.mjs and in match.mjs).
//
//   isItemPath(p)    the path ENDS in a parameter segment: `/x/:id`, and also `/a/:id/b/:sub` (the last segment decides)
//   pathParams(p)    the parameter names, in order
//   isWired(p)       always true now (LIN-250/TR-49): the generator (src/emit.mjs) can call ANY path, with any
//                    number of path parameters, anywhere in the path (list, create, update, remove, or an "extra"
//                    endpoint, see match.mjs's `findEndpoints`). `emit.mjs`'s `param`/`toUrl` already use a global
//                    regex match over every `:param` in the path (no count limit), so there is no remaining
//                    technical reason to cap the parameter count; the old <=2 cap (LIN-223) is lifted.
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
 * True when the generator (`src/emit.mjs`) can call this path. Always true (LIN-250/TR-49): `param`/`toUrl` in
 * `emit.mjs` fill every `:param` in the path via a global regex, with no limit on how many, so any number of
 * path parameters — zero, one, two, or three or more, trailing or not — is wired. The old two-param cap
 * (LIN-223) is lifted; this stays a named function (rather than inlining `true`) so call sites read the same way
 * and the cap can come back in one place if a real limitation is ever found.
 *
 * @param {string} p A path.
 * @returns {boolean} Always `true`.
 */
export const isWired = (p) => true;
