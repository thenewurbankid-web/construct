// AST package: the facts CLIENT-001 (#644) is built from -- a module's leading directive, the value
// edges it draws to other modules, and the non-public environment variables it reads. Pure reads over
// a parsed Program; no filesystem, no rule knowledge (packages/core/client-boundary.mjs decides).
import { walk as walkAst } from 'estree-walker';
import { lineOf } from './extract.mjs';

/**
 * The module directive at the top of a file: `'use client'`, `'use server'`, or null. Reads the real
 * directive prologue (the run of leading string-literal statements the parser marks `directive`), so a
 * string in a comment, a parenthesised `('use client')` or a string later in the file never counts.
 *
 * @param {object} ast A parsed Program (from `parseToAst`).
 * @returns {'client'|'server'|null} `'client'` for `'use client'`, `'server'` for `'use server'`, otherwise `null`.
 *
 * @example
 * readModuleDirective(parseToAst("'use client';\nimport a from 'a';")); // => 'client'
 */
export function readModuleDirective(ast) {
  let found = null;
  for (const node of ast.body) {
    if (node.type !== 'ExpressionStatement' || typeof node.directive !== 'string') break;
    if (node.directive === 'use client') found = 'client';
    else if (node.directive === 'use server') found = found || 'server';
  }
  return found;
}

/** A dynamic `import(...)` source that is a plain string: a Literal, or a TemplateLiteral with no `${}` parts. */
function staticSpecifier(source) {
  if (source?.type === 'Literal' && typeof source.value === 'string') return source.value;
  if (source?.type === 'TemplateLiteral' && source.expressions.length === 0 && source.quasis.length === 1) return source.quasis[0].value.cooked;
  return null;
}

/**
 * Every value edge a module draws to another module, in source order: static `import`, a re-export
 * (`export ... from`, `export * from`) and a dynamic `import('...')` with a literal specifier. Edges the
 * compiler erases are left out -- `import type ...`, `import { type A } ...` where every specifier is
 * type-only, and `export type ... from` -- because they put nothing in a bundle. A dynamic import whose
 * specifier is computed cannot be read and is not listed.
 *
 * @param {object} ast A parsed Program (from `parseToAst`).
 * @param {string} source The source text the AST was parsed from (for line numbers).
 * @returns {{specifier:string, kind:'import'|'reexport'|'dynamic', line:number, index:number}[]} The edges, each with its specifier, kind and 1-based line.
 *
 * @example
 * collectModuleEdges(parseToAst("import type { A } from './a'; export * from './b';"), src); // => [{ specifier: './b', kind: 'reexport', ... }]
 */
export function collectModuleEdges(ast, source) {
  const edges = [];
  const push = (specifier, kind, node) => edges.push({ specifier, kind, index: node.range[0], line: lineOf(source, node.range[0]) });
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      if (node.importKind === 'type') continue;
      if (node.specifiers.length > 0 && node.specifiers.every((s) => s.importKind === 'type')) continue;
      push(node.source.value, 'import', node);
    } else if (node.type === 'ExportNamedDeclaration' && node.source) {
      if (node.exportKind === 'type') continue;
      if (node.specifiers.length > 0 && node.specifiers.every((s) => s.exportKind === 'type')) continue;
      push(node.source.value, 'reexport', node);
    } else if (node.type === 'ExportAllDeclaration') {
      if (node.exportKind === 'type') continue;
      push(node.source.value, 'reexport', node);
    }
  }
  walkAst(ast, {
    enter(node) {
      if (node.type !== 'ImportExpression') return;
      const specifier = staticSpecifier(node.source);
      if (specifier !== null) push(specifier, 'dynamic', node);
    },
  });
  return edges.sort((a, b) => a.index - b.index);
}

const isProcessEnv = (n) => n?.type === 'MemberExpression' && !n.computed && n.object?.type === 'Identifier' && n.object.name === 'process'
  && n.property?.type === 'Identifier' && n.property.name === 'env';

/**
 * Every read of a named `process.env` variable, in source order: `process.env.NAME`, `process.env['NAME']`,
 * `process.env?.NAME`, and destructuring `const { NAME } = process.env`. Names in `publicNames` and names
 * starting with one of `publicPrefixes` are left out (a bundler inlines those at build time, so reading
 * them in the browser is the point). A bare `process.env` (spread, passed on, computed key) names no
 * variable and is not listed.
 *
 * @param {object} ast A parsed Program (from `parseToAst`).
 * @param {string} source The source text the AST was parsed from (for line numbers).
 * @param {{publicPrefixes?: string[], publicNames?: string[]}} [opts] What counts as public; defaults to the `NEXT_PUBLIC_` prefix and `NODE_ENV`.
 * @returns {{name:string, line:number, index:number}[]} Each non-public read with its variable name and 1-based line.
 *
 * @example
 * collectSecretEnvReads(parseToAst('const k = process.env.STRIPE_SECRET;'), src); // => [{ name: 'STRIPE_SECRET', line: 1, ... }]
 */
export function collectSecretEnvReads(ast, source, { publicPrefixes = ['NEXT_PUBLIC_'], publicNames = ['NODE_ENV'] } = {}) {
  const reads = [];
  const isPublic = (name) => publicNames.includes(name) || publicPrefixes.some((p) => name.startsWith(p));
  const add = (name, node) => { if (typeof name === 'string' && !isPublic(name)) reads.push({ name, index: node.range[0], line: lineOf(source, node.range[0]) }); };
  walkAst(ast, {
    enter(node) {
      if (node.type === 'MemberExpression' && isProcessEnv(node.object)) {
        if (!node.computed && node.property.type === 'Identifier') add(node.property.name, node);
        else if (node.computed && node.property.type === 'Literal') add(node.property.value, node);
      } else if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && isProcessEnv(node.init)) {
        for (const p of node.id.properties) {
          if (p.type !== 'Property' || p.computed) continue;
          add(p.key.type === 'Identifier' ? p.key.name : p.key.value, p);
        }
      }
    },
  });
  return reads.sort((a, b) => a.index - b.index);
}
