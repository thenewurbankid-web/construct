// The ONE seam between Trace and the Construct framework. Nothing else in Trace imports Construct.
//
// Construct is not published (private monorepo), so its modules are loaded at run time from a checkout named by
// CONSTRUCT_ROOT (unset by default; a read-only checkout is /Users/shashank/Repositories/construct-worktrees/cockpit-main).
// If the variable is unset, the path is wrong, or the import fails, the loaders return null and the caller falls back
// to Trace's own code, so the app never fails to start because Construct is absent. Never edit Construct from here.
import path from "node:path";
import { pathToFileURL } from "node:url";

const AST_EXPORTS = ["parseJsx", "walkAst", "jsxNameToString", "spliceNode", "renderAttrValue"];
const TEXT_DIFF_EXPORTS = ["buildDiffView"];
const TRANSACTIONAL_WRITER_EXPORTS = ["createTransaction"];
const cache = new Map(); // root -> Promise<object|null>, so each root is imported once
const textDiffCache = new Map(); // root -> Promise<object|null>, so each root is imported once
const transactionalWriterCache = new Map(); // root -> Promise<object|null>, so each root is imported once

/**
 * Import Construct's AST package (`packages/ast`) from a checkout.
 *
 * @param {string|undefined} root Construct checkout directory (the value of CONSTRUCT_ROOT).
 * @returns {Promise<{parseJsx:Function, walkAst:Function, jsxNameToString:Function, spliceNode:Function, renderAttrValue:Function}|null>}
 *   The functions Trace uses, or `null` when `root` is empty, the import fails, or an export is missing.
 */
export function importConstructAst(root) {
  if (!root) return Promise.resolve(null);
  if (!cache.has(root)) {
    cache.set(root, import(pathToFileURL(path.join(root, "packages", "ast", "index.mjs")).href)
      .then((m) => (AST_EXPORTS.every((n) => typeof m[n] === "function") ? Object.fromEntries(AST_EXPORTS.map((n) => [n, m[n]])) : null))
      .catch(() => null));
  }
  return cache.get(root);
}

/**
 * Import Construct's core text-diff module (`packages/core/text-diff.mjs`) from a checkout.
 *
 * @param {string|undefined} root Construct checkout directory (the value of CONSTRUCT_ROOT).
 * @returns {Promise<{buildDiffView:Function}|null>} `{buildDiffView}`, or `null` when `root` is empty, the
 *   import fails, or the export is missing.
 */
export function importConstructTextDiff(root) {
  if (!root) return Promise.resolve(null);
  if (!textDiffCache.has(root)) {
    textDiffCache.set(root, import(pathToFileURL(path.join(root, "packages", "core", "text-diff.mjs")).href)
      .then((m) => (TEXT_DIFF_EXPORTS.every((n) => typeof m[n] === "function") ? Object.fromEntries(TEXT_DIFF_EXPORTS.map((n) => [n, m[n]])) : null))
      .catch(() => null));
  }
  return textDiffCache.get(root);
}

/**
 * Import Construct's engine transactional-writer module (`packages/engine/transactionalWriter.mjs`) from a
 * checkout.
 *
 * @param {string|undefined} root Construct checkout directory (the value of CONSTRUCT_ROOT).
 * @returns {Promise<{createTransaction:Function}|null>} `{createTransaction}`, or `null` when `root` is empty,
 *   the import fails, or the export is missing.
 */
export function importConstructTransactionalWriter(root) {
  if (!root) return Promise.resolve(null);
  if (!transactionalWriterCache.has(root)) {
    transactionalWriterCache.set(root, import(pathToFileURL(path.join(root, "packages", "engine", "transactionalWriter.mjs")).href)
      .then((m) => (TRANSACTIONAL_WRITER_EXPORTS.every((n) => typeof m[n] === "function") ? Object.fromEntries(TRANSACTIONAL_WRITER_EXPORTS.map((n) => [n, m[n]])) : null))
      .catch(() => null));
  }
  return transactionalWriterCache.get(root);
}

// Loaded once, at start-up, so the parse functions that use it can stay synchronous.
const loaded = await importConstructAst(process.env.CONSTRUCT_ROOT);
const loadedTextDiff = await importConstructTextDiff(process.env.CONSTRUCT_ROOT);
const loadedTransactionalWriter = await importConstructTransactionalWriter(process.env.CONSTRUCT_ROOT);

/**
 * The AST package from `CONSTRUCT_ROOT`, or `null` (unset, bad path, import failed): then use Trace's own code.
 *
 * @returns {{parseJsx:Function, walkAst:Function, jsxNameToString:Function, spliceNode:Function, renderAttrValue:Function}|null}
 *   Cached; the same object on every call.
 */
export function loadConstructAst() {
  return loaded;
}

/**
 * Construct's core text-diff module from `CONSTRUCT_ROOT`, or `null` (unset, bad path, import failed): callers
 * that want a before/after text diff (e.g. the contract-drift report, T27) then simply omit that part of their
 * output, since a line-diff view is a display convenience, not something the caller re-implements.
 *
 * @returns {{buildDiffView:Function}|null} Cached; the same object on every call.
 */
export function loadConstructTextDiff() {
  return loadedTextDiff;
}

/**
 * Construct's engine transactional-writer module from `CONSTRUCT_ROOT`, or `null` (unset, bad path, import
 * failed): then use Trace's own fallback (`src/write-transaction.mjs`'s in-process buffer). Note: Trace never
 * calls `createTransaction(...).commit()` with Construct's default `validate` (`validateArchitecture`) — that
 * enforcer expects plural layer folders (`controllers/`, `services/`, ...) and an `architecture.yml` that
 * Trace's generated features don't have (see `docs/CONSTRUCT-REUSE.md`), so every caller overrides `validate`
 * and only reuses the buffer/commit-or-rollback mechanism, never Construct's architecture rules.
 *
 * @returns {{createTransaction:Function}|null} Cached; the same object on every call.
 */
export function loadConstructTransactionalWriter() {
  return loadedTransactionalWriter;
}

// ---- more of Construct, on request (Page map, src/pagemap/) ----
const moduleCache = new Map(); // `${root}|${rel}` -> Promise<object|null>

/**
 * Import ONE named module of a Construct checkout, for a caller that wants it and can do without it.
 * Same rules as `importConstructAst`: `null` when `root` is empty, the file or an export is missing, or the import throws.
 *
 * @param {string|undefined} root Construct checkout directory (CONSTRUCT_ROOT).
 * @param {string} rel Path of the module below `root`, e.g. `packages/engine/jsxSourceAnnotator.mjs`.
 * @param {string[]} names The exports the caller needs (all must be functions).
 * @returns {Promise<Object<string,Function>|null>} The named functions, or `null`.
 */
export function importConstructModule(root, rel, names) {
  if (!root) return Promise.resolve(null);
  const key = `${root}|${rel}`;
  if (!moduleCache.has(key)) {
    moduleCache.set(key, import(pathToFileURL(path.join(root, rel)).href)
      .then((m) => (names.every((n) => typeof m[n] === "function") ? Object.fromEntries(names.map((n) => [n, m[n]])) : null))
      .catch(() => null));
  }
  return moduleCache.get(key);
}

/** Construct's click-to-source annotator (`data-cx-src="<file>:<line>:<col>"` on every host element), or `null`. */
export const importConstructAnnotator = (root = process.env.CONSTRUCT_ROOT) => importConstructModule(root, "packages/engine/jsxSourceAnnotator.mjs", ["annotateJsxSource", "parseCxSrc"]);

/**
 * Construct's diagnostic-contract validator (`makeViolation`, `assertValidViolation`), or `null`.
 *
 * `makeViolation` validates `module` against a CLOSED set (`architecture`, `separation-of-concerns`, `readability`) that
 * none of Trace's pagemap rules belong to, so calling it against a Trace violation always throws (a checked test in
 * pagemap.test.mjs proves the field SET otherwise matches, with a placeholder module). Trace keeps building and returning
 * its own violation object (pagemap/violations.mjs); this loader exists so that check goes through the one seam instead
 * of a raw `packages/core/diagnostics.mjs` path string living in a test.
 */
export const importConstructDiagnostics = (root = process.env.CONSTRUCT_ROOT) => importConstructModule(root, "packages/core/diagnostics.mjs", ["makeViolation", "assertValidViolation"]);

/**
 * Construct's live-preview fiber resolver (`resolveFiberSelection`, the pure half of `packages/engine/previewFiber.mjs`)
 * and its in-page bridge (`installPreviewFiberBridge`, `previewFiberBridgeScript`), or `null`.
 *
 * `resolveFiberSelection` turns a clicked DOM element's React-fiber evidence into a source location, walking fiber
 * `.return` ancestors to find the nearest CUSTOM-COMPONENT ancestor (the call site `<Foo .../>`, not Foo's own host
 * elements) -- the direction `jsxSourceAnnotator` does not cover (it stamps host elements with their OWN file:line:col
 * only; a custom component's call site, in its PARENT's file, carries no such attribute). See `pagemap/clicktosource.mjs`,
 * which uses this when a checkout is present and falls back to Trace's own (annotation + debug-source only) resolver
 * otherwise.
 */
export const importConstructPreviewFiber = (root = process.env.CONSTRUCT_ROOT) => importConstructModule(root, "packages/engine/previewFiber.mjs", ["resolveFiberSelection", "installPreviewFiberBridge", "previewFiberBridgeScript"]);
