// The import block's parser seam: Construct's AST package when CONSTRUCT_ROOT provides it (via src/construct.mjs),
// Trace's own Babel-based fallback otherwise. Same five functions, same results; ENGINE says which one is running.
// Swapping the parser means changing this file, fallback-ast.mjs and parse.mjs only.
import { loadConstructAst } from "../construct.mjs";
import * as fallback from "./fallback-ast.mjs";

const construct = loadConstructAst();
const ast = construct ?? fallback;

/** Which parser is active: `"construct"` (packages/ast from CONSTRUCT_ROOT) or `"babel"` (the fallback). */
export const ENGINE = construct ? "construct" : "babel";
export const { parseJsx, walkAst, jsxNameToString, spliceNode, renderAttrValue } = ast;
