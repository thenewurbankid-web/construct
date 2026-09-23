// AST package: inserting a brand-new top-level import statement (#532, Slice 2 of #518's design,
// docs/design/block-palette.md) -- the missing primitive the existing edit ops (jsxEdit.mjs) don't
// cover: every function there edits an EXISTING JSX node's text; this adds a whole new
// ImportDeclaration, located by parsing (not guessed by regex on raw text, so a `from` string inside a
// comment or a template literal is never mistaken for a real import).
import { parseToAst } from './parse.mjs';

/**
 * Insert `import { name } from '<specifier>';` (or `import name from '<specifier>';` for
 * `isDefault`) as a new top-level import: right after the last existing import if there is one,
 * otherwise right after a leading directive prologue (`'use client';`, `'use server';`, ...) if
 * present, otherwise at the very top of the file. Idempotent: does nothing (`inserted: false`) when
 * an import already binds exactly this local name to exactly this specifier.
 *
 * @param {string} source Full source text.
 * @param {{name:string, specifier:string, isDefault?:boolean}} spec What to import.
 * @returns {{source:string, inserted:boolean}} The (possibly unchanged) source, and whether a line was added.
 */
export function insertNamedImport(source, { name, specifier, isDefault = false }) {
  const ast = parseToAst(source);
  const imports = ast.body.filter((n) => n.type === 'ImportDeclaration');
  const alreadyPresent = imports.some(
    (n) =>
      n.source.value === specifier &&
      n.specifiers.some((s) => s.local.name === name && (isDefault ? s.type === 'ImportDefaultSpecifier' : s.type === 'ImportSpecifier')),
  );
  if (alreadyPresent) return { source, inserted: false };

  const line = isDefault ? `import ${name} from '${specifier}';` : `import { ${name} } from '${specifier}';`;

  if (imports.length > 0) {
    const last = imports[imports.length - 1];
    let at = last.range[1];
    if (source[at] === '\r') at += 1;
    if (source[at] === '\n') at += 1;
    return { source: source.slice(0, at) + line + '\n' + source.slice(at), inserted: true };
  }

  // No imports yet: skip past a leading directive prologue (string-literal expression statements,
  // e.g. 'use client';) so it stays the file's first line.
  let at = 0;
  for (const node of ast.body) {
    const isDirective = node.type === 'ExpressionStatement' && node.expression?.type === 'Literal' && typeof node.expression.value === 'string';
    if (!isDirective) break;
    at = node.range[1];
    if (source[at] === '\r') at += 1;
    if (source[at] === '\n') at += 1;
  }
  return { source: source.slice(0, at) + line + '\n' + source.slice(at), inserted: true };
}
