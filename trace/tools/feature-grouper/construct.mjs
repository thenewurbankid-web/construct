// The ONE seam between feature-grouper and the Construct framework. Nothing else in this tool imports Construct.
//
// Construct is not published (private monorepo), so `parseJsxTree` (packages/ast/index.mjs) is imported at run time
// from a checkout: CONSTRUCT_ROOT, default /Users/shashank/Repositories/construct-worktrees/cockpit-main (read-only;
// never edited from here). Set CONSTRUCT_ROOT to an empty string (or "none") to force the fallback. If the
// checkout is missing or the import fails, the tool falls back to its own parser (./fallback-parse.mjs, on
// @babel/parser, already a dependency of line-matcher) and says so in `reason`.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsxTree as fallbackParseJsxTree } from "./fallback-parse.mjs";

/** Default Construct checkout (a read-only worktree of origin/main). */
export const DEFAULT_CONSTRUCT_ROOT = "/Users/shashank/Repositories/construct-worktrees/cockpit-main";

const cache = new Map(); // root -> Promise<parser info>

/**
 * @typedef {object} ParserInfo
 * @property {"construct"|"babel"} engine Which parser is active.
 * @property {(source:string) => {roots:object[], byId:Map<string,object>, ast:object}} parseJsxTree Parse JSX/TSX
 *   into the element tree ({id, tag, isFragment, isCustomComponent, props, start, end, line, children}); throws on a
 *   syntax error.
 * @property {string} reason Why this engine is running (for the report line).
 */

/**
 * Load the JSX tree parser: Construct's `parseJsxTree` from `root`, else the local fallback.
 *
 * @param {string|undefined} root Construct checkout directory; `undefined` = the default root, `""`/`"none"` =
 *   do not use Construct.
 * @returns {Promise<ParserInfo>} The parser and which engine it is. Cached per root.
 */
export function loadParser(root = DEFAULT_CONSTRUCT_ROOT) {
  const key = root ?? DEFAULT_CONSTRUCT_ROOT;
  if (!cache.has(key)) cache.set(key, importParser(key));
  return cache.get(key);
}

async function importParser(root) {
  if (!root || root === "none") {
    return { engine: "babel", parseJsxTree: fallbackParseJsxTree, reason: "Construct disabled (CONSTRUCT_ROOT empty or none)" };
  }
  try {
    const mod = await import(pathToFileURL(path.join(root, "packages", "ast", "index.mjs")).href);
    if (typeof mod.parseJsxTree !== "function") throw new Error("packages/ast does not export parseJsxTree");
    return { engine: "construct", parseJsxTree: mod.parseJsxTree, reason: `parseJsxTree from ${root}` };
  } catch (e) {
    return { engine: "babel", parseJsxTree: fallbackParseJsxTree, reason: `Construct not usable at ${root} (${e.message.split("\n")[0]}); own Babel parser` };
  }
}

/** The parser for this process, decided once from CONSTRUCT_ROOT (unset = the default checkout). */
export const PARSER = await loadParser(process.env.CONSTRUCT_ROOT);
