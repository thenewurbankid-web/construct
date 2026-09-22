// Thin REST adapter over src/engine/unitSummary.mjs (deterministic unit summaries for bots and the
// Cockpit). No logic of its own: parse the query, call the core function, map the structured
// result/error to an HTTP status. Read-only; refs are confined to the current project root by the
// core (".." segments rejected, symlinks escaping the root are not read). Same-origin/CORS guard is
// applied globally in index.mjs.
import { summarizeUnit, listUnits, listFeatures } from '../../../packages/engine/unitSummary.mjs';

const STATUS = { INVALID_ARGUMENT: 400, UNKNOWN_KIND: 400, UNIT_NOT_FOUND: 404, UNIT_AMBIGUOUS: 409, ROOT_NOT_FOUND: 400, INTERNAL_ERROR: 500 };
const one = (v) => (Array.isArray(v) ? v[0] : v);
const respond = (result) => ({ status: result.ok ? 200 : STATUS[result.error.code] || 500, body: result });

const options = (q) => ({
  ...(one(q.detail) ? { detail: String(one(q.detail)) } : {}),
  ...(one(q.kind) ? { kind: String(one(q.kind)) } : {}),
  ...(one(q.include) ? { include: String(one(q.include)).split(',').map((s) => s.trim()).filter(Boolean) } : {}),
});

/** @returns {{status:number, body:object}} */
export const unitsIndex = (root, q = {}) => respond(listUnits(root, one(q.kind) ? { kind: String(one(q.kind)) } : {}));
export const unitSummary = (root, q = {}) => respond(summarizeUnit(root, String(one(q.ref) ?? ''), options(q)));
export const featuresIndex = (root) => respond(listFeatures(root));
export const featureSummary = (root, name, q = {}) => respond(summarizeUnit(root, `feature:${name}`, { ...options(q), kind: undefined }));
