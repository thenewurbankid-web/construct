// AST package: TypeScript compiler API helpers -- searching a ts.SourceFile and printing
// `ts.factory` nodes back to source. (Builders themselves are just `ts.factory`, via the `ts` re-export.)
import ts from 'typescript';

export { ts };

/** First node under (and including) `root` matching `predicate`, depth-first, or null. */
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

/** Every node under (and including) `root` matching `predicate`, depth-first pre-order. */
export function findAllNodes(root, predicate) {
  const results = [];
  const visit = (node) => {
    if (predicate(node)) results.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return results;
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const DUMMY_SOURCE_FILE = ts.createSourceFile('generated.ts', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

/** Print a `ts.factory`-built node as TypeScript source (LF newlines). */
export function printNode(node) {
  return printer.printNode(ts.EmitHint.Unspecified, node, DUMMY_SOURCE_FILE);
}
