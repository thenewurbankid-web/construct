// LIN-90 §5 / docs/ADAPTER-PERSISTENCE.md (decided 2026-09-30, Option A: runtime-only; design constraint added
// same day, owner directive: Option A must not foreclose promoting to Option B later). A saved adapter mapping
// lives next to the example's other run state (`answers.json`, `decisions.json`) as `adapters.json`, but its
// shape is a direct `x-trace-adapter` vendor-extension candidate: keyed by the same operation identifier
// `contract.mjs`/`parts.mjs`'s `endpointKey()` already uses ("GET /api/orders"), then by field name — not by
// anything run-state-only (a question id, a wire id). One accessor pair (`getAdapterFor`/`saveAdapterFor`) is
// the only thing that knows where the mapping actually lives today; a later promotion to Option B only has to
// change what's inside these two functions, never their callers. This module never touches the contract file:
// `contract.mjs`'s `loadContract`/`saveContract` are untouched, and a contract stays a straight parse of the
// OpenAPI/Swagger document, nothing Trace-specific layered in.
import fs from "node:fs";
import path from "node:path";

/** @param {string} dir The example's directory. */
export const adapterFile = (dir) => path.join(dir, "adapters.json");

/**
 * Everything saved so far, in storage shape: `{ [operationId]: { [field]: mapping } }`. Prefer `getAdapterFor`
 * for a single lookup; this is for listing (the details card needs "does this endpoint have any adapters").
 * Missing or unreadable file reads as no adapters (same "absence is not an error" convention `answers.json`/
 * `decisions.json` already follow elsewhere).
 *
 * @param {string} dir
 * @returns {Record<string, Record<string, {transform: string, params: object, savedAt: string}>>}
 */
export function loadAdapters(dir) {
  try {
    return JSON.parse(fs.readFileSync(adapterFile(dir), "utf8"));
  } catch {
    return {};
  }
}

/**
 * The one saved mapping for a field on an operation, or `null`. `operationId` is `endpointKey()`'s
 * `"METHOD /path"` — the same identifier an `x-trace-adapter` extension would key on, so this reads the same
 * way regardless of whether the mapping ends up living here or in the contract.
 *
 * @param {string} dir
 * @param {string} operationId
 * @param {string} field
 * @returns {{transform: string, params: object, savedAt: string}|null}
 */
export function getAdapterFor(dir, operationId, field) {
  return loadAdapters(dir)[operationId]?.[field] ?? null;
}

/**
 * Save one field's mapping on one operation, merging into whatever this example already has (every other
 * operation's and field's mapping is untouched). Only writes the file when the content actually changed,
 * matching `pipeline.mjs`'s own `answers.json`/`decisions.json` write guard (so a file watcher doesn't
 * re-trigger itself on a no-op save). The mapping itself carries no run-state-only identifier — no question
 * id, no wire id — only what an `x-trace-adapter` extension on the contract would also carry.
 *
 * @param {string} dir
 * @param {string} operationId `endpointKey()`'s `"METHOD /path"`.
 * @param {string} field The field name on that operation's request/response body.
 * @param {{transform: string, params?: object}} mapping
 * @returns {Record<string, object>} The full, updated map (storage shape).
 */
export function saveAdapterFor(dir, operationId, field, mapping) {
  const current = loadAdapters(dir);
  const next = { ...current, [operationId]: { ...current[operationId], [field]: { transform: mapping.transform, params: mapping.params ?? {}, savedAt: new Date().toISOString() } } };
  const text = JSON.stringify(next, null, 2) + "\n";
  const prevText = fs.existsSync(adapterFile(dir)) ? fs.readFileSync(adapterFile(dir), "utf8") : null;
  if (text !== prevText) fs.writeFileSync(adapterFile(dir), text);
  return next;
}
