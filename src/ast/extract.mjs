// AST package: extraction. Read structured facts (imports, exports, JSDoc) out of a source string.
import { walk as walkAst } from 'estree-walker';
import { parseToAst } from './parse.mjs';

/** Recursively collect every bound identifier name out of a destructuring
 * pattern (Identifier, ObjectPattern, ArrayPattern, AssignmentPattern,
 * RestElement), e.g. `const { a, b: renamed, ...rest } = x` -> ['a',
 * 'renamed', 'rest']. Used by extractExports for `export const`/`let`/`var`
 * so every declared binding is reported, not just the first identifier
 * after the keyword (a real gap in the old regex-based version). */
function collectPatternNames(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      out.push(node.name);
      break;
    case 'ObjectPattern':
      for (const prop of node.properties) {
        collectPatternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of node.elements) collectPatternNames(el, out);
      break;
    case 'AssignmentPattern':
      collectPatternNames(node.left, out);
      break;
    case 'RestElement':
      collectPatternNames(node.argument, out);
      break;
    default:
      break;
  }
}

/** Walk collecting every `import('...')` dynamic-import expression
 * (ImportExpression nodes) reachable anywhere in the tree — unlike static
 * ImportDeclarations, these aren't confined to the top level of
 * Program.body. Only literal string sources are collected (an expression
 * source, e.g. `import(path)`, isn't a specifier and was never matched by
 * the old regex either). Uses estree-walker (a well-established generic
 * ESTree traversal library) rather than a hand-rolled recursive walk. */
function collectDynamicImports(ast, out) {
  walkAst(ast, {
    enter(node) {
      if (node.type === 'ImportExpression' && node.source?.type === 'Literal' && typeof node.source.value === 'string') {
        out.push({ index: node.range[0], value: node.source.value });
      }
    },
  });
}

/** Module specifiers referenced by static or dynamic import, e.g. `import x from 'y'` or `import('y')`,
 * in source-position order. AST-based: walks real ImportDeclaration nodes plus ImportExpression
 * (dynamic `import(...)`) nodes anywhere in the tree, so a specifier-shaped string sitting inside a
 * comment or a string literal is never mistaken for a real import (the #74 false-positive class). */
export function extractImports(source) {
  const ast = parseToAst(source);
  const entries = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') entries.push({ index: node.range[0], value: node.source.value });
  }
  collectDynamicImports(ast, entries);
  return entries.sort((a, b) => a.index - b.index).map((e) => e.value);
}

/** Exported identifiers with their source index, sorted by position. Handles named
 * function/class/const/let/var exports (including destructured/multi-declarator
 * `export const a = 1, { b, c: renamed } = obj`), `export default function|class <Name>`,
 * `export default <identifier>;`, `export { a, b as c }` lists (alias wins), and
 * wildcard re-exports (`export * from '...'`, `export type * from '...'` — named
 * after their module specifier, since there's no local identifier to report).
 * AST-based: reads real ExportNamedDeclaration/ExportDefaultDeclaration/
 * ExportAllDeclaration nodes instead of scanning raw text, so `index` always points at
 * the true start of the export statement (the `export` keyword — decorators, if any,
 * sit *before* it in source and are handled separately by extractJsdoc, not here). */
export function extractExports(source) {
  const ast = parseToAst(source);
  const results = [];
  const push = (name, index) => { if (name) results.push({ name, index }); };

  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      const decl = node.declaration;
      if (decl) {
        if (decl.type === 'VariableDeclaration') {
          for (const declarator of decl.declarations) {
            const names = [];
            collectPatternNames(declarator.id, names);
            for (const name of names) push(name, node.range[0]);
          }
        } else {
          // FunctionDeclaration / ClassDeclaration / TSDeclareFunction, etc. — anything with an `id`.
          push(decl.id?.name, node.range[0]);
        }
      } else if (node.specifiers?.length) {
        for (const spec of node.specifiers) {
          push(spec.exported?.name ?? spec.exported?.value, node.range[0]);
        }
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      const name = decl.type === 'Identifier' ? decl.name : (decl.id?.name || 'default');
      push(name, node.range[0]);
    } else if (node.type === 'ExportAllDeclaration') {
      push(node.exported?.name || node.source?.value, node.range[0]);
    }
  }
  return results.sort((a, b) => a.index - b.index);
}

/** The `/** ... *\/` JSDoc block belonging to the export statement starting at `index`
 * (as returned by extractExports), or null. AST-based: finds the block comment
 * immediately preceding the declaration, walking back past any leading decorators
 * (`@Component(...)`) sitting between the comment and the declaration they annotate —
 * this is the fix for #19, where regex-based "immediately preceding" association broke
 * on a decorator in between. Falls back to treating `index` itself as the boundary
 * when it doesn't match a parsed top-level export node (defensive; every real call site
 * passes an index from extractExports). */
export function extractJsdoc(source, index) {
  const ast = parseToAst(source);
  const node = ast.body.find((n) => n.range && n.range[0] === index);
  const decorators = node?.declaration?.decorators || node?.decorators || [];
  const boundary = decorators.length ? Math.min(...decorators.map((d) => d.range[0])) : index;

  let best = null;
  for (const comment of ast.comments || []) {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
    if (comment.range[1] > boundary) continue;
    if (!best || comment.range[1] > best.range[1]) best = comment;
  }
  if (!best) return null;
  if (/\S/.test(source.slice(best.range[1], boundary))) return null;
  return source.slice(best.range[0], best.range[1]);
}

/** 1-based line number of character offset `index` in `source`. */
export function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/** Import specifiers from top-level `import ... from '...'` declarations only (not
 * dynamic import()), with each entry's source position — layer-boundary imports in
 * this codebase's conventions are always static, and a position is needed for
 * per-rule line-number reporting (extractImports from parser.mjs returns just the
 * specifier strings, with no position). */
export function staticImportEntries(ast) {
  const entries = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') entries.push({ value: node.source.value, index: node.range[0] });
  }
  return entries;
}
