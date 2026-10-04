// AST package: typed-boundary detection for TYPE-002 (LIN-148 ask #2).
//
// LIN-148 (owner decision 2026-09-30): every unit at every layer declares explicit types on
// its inputs and outputs -- no implicit any, no untyped boundary. This module finds the two
// AST-detectable shapes of that: an exported function (declaration, or a const/default bound
// to a function/arrow expression) with a parameter that has no type annotation, or with no
// return-type annotation of its own. Both read typescript-estree's own `typeAnnotation`/
// `returnType` fields -- never a string/regex guess at "looks typed" -- so a param whose type
// is merely hard to read is never flagged, only one the parser itself recorded as absent.
import { walkForUsage } from './walk.mjs';

const isExportedFunctionLike = (node, parent) => {
  if (node.type !== 'FunctionDeclaration' && node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') return false;
  if (!parent) return false;
  if (parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration') return true;
  // `export const foo = (...) => ...` / `export function foo(){}` assigned through a declarator
  // the walk also visits the declarator's own ancestry, so this only fires for the top-level
  // `export const` case, not every local variable holding a function.
  return false;
};

/**
 * Every parameter on an exported function-like node (declaration, or default/named export of a
 * function/arrow expression) that typescript-estree parsed with no `typeAnnotation` -- i.e. an
 * implicit `any`, not merely a type that is hard to read -- plus the function itself when it has
 * no `returnType`. A destructuring/rest param with no annotation is reported once, named by its
 * position (`arg0`) since it has no single identifier name.
 *
 * @param {object} ast A parsed Program (see parseToAst).
 * @returns {{kind: 'param'|'return', functionName: string, paramName?: string, index: number}[]} Untyped boundaries, sorted by offset.
 */
export function collectUntypedExportedBoundaries(ast) {
  const hits = [];
  const seen = new Set();
  const visit = (node, parent) => {
    if (!isExportedFunctionLike(node, parent)) return;
    if (seen.has(node)) return;
    seen.add(node);
    const functionName = node.id?.name ?? (parent.type === 'ExportDefaultDeclaration' ? 'default' : '(anonymous)');
    node.params.forEach((p, i) => {
      // A param itself may be wrapped (AssignmentPattern for a default value, RestElement);
      // the annotation lives on the wrapped node for AssignmentPattern, on the RestElement
      // itself otherwise -- both are plain `typeAnnotation` on the node typescript-estree gives us.
      const target = p.type === 'AssignmentPattern' ? p.left : p;
      if (!target.typeAnnotation) {
        hits.push({ kind: 'param', functionName, paramName: target.name ?? `arg${i}`, index: p.range[0] });
      }
    });
    if (!node.returnType) {
      hits.push({ kind: 'return', functionName, index: node.range[0] });
    }
  };
  // Top-level export declarations only (LIN-148 ask #2 is a boundary check -- a unit's own
  // internal helpers are not the boundary); walkForUsage's non-usage skip (import/export
  // specifier lists) doesn't apply to a declaration's own function node, so this still sees it.
  for (const stmt of ast.body) {
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
      visit(stmt.declaration, stmt);
      if (stmt.declaration.type === 'VariableDeclaration') {
        for (const decl of stmt.declaration.declarations) {
          if (decl.init) visit(decl.init, stmt);
        }
      }
    } else if (stmt.type === 'ExportDefaultDeclaration') {
      visit(stmt.declaration, stmt);
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}
