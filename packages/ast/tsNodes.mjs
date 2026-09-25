// AST package: TypeScript compiler API helpers -- searching a ts.SourceFile and printing
// `ts.factory` nodes back to source. (Builders themselves are just `ts.factory`, via the `ts` re-export.)
import { ts } from './lazy.mjs';

export { ts };

/**
 * First node under (and including) `root` matching `predicate`, depth-first, or null.
 *
 * @param {any} root Node to search under.
 * @param {(node: any) => boolean} predicate Match test.
 * @returns {any} The first match, or `null`.
 */
export function findNode(root, predicate) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (predicate(node)) { found = node; return; }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * Every node under (and including) `root` matching `predicate`, depth-first pre-order.
 *
 * @param {any} root Node to search under.
 * @param {(node: any) => boolean} predicate Match test.
 * @returns {any[]} Every match, in pre-order.
 */
export function findAllNodes(root, predicate) {
  const results = [];
  const visit = (node) => {
    if (predicate(node)) results.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return results;
}

let printer;
let dummySourceFile;

/**
 * Print a `ts.factory`-built node as TypeScript source (LF newlines).
 *
 * @param {any} node A node built with `ts.factory`.
 * @returns {string} TypeScript source with LF newlines.
 */
export function printNode(node) {
  printer ??= ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  dummySourceFile ??= ts.createSourceFile('generated.ts', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return printer.printNode(ts.EmitHint.Unspecified, node, dummySourceFile);
}
