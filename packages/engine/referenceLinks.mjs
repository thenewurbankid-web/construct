// Reference links (#321): which identifiers in a source file point at another file, decided
// deterministically from the AST -- no I/O, no LLM. Two pure blocks:
//   - collectReferences(source): every place a name imported from another module is used as a
//     link candidate (the import binding itself and each JSX tag), plus the ones that can never be
//     resolved (dynamic `import()`, a component that is not imported).
//   - exportOrigin(source, name): where a module gets one of its exports from (declared here, or
//     re-exported from another module) -- what lets a barrel (`export { X } from './X'`) resolve.
// File resolution (relative specifier -> real file, inside the project root) is the caller's job; see
// ui/server/src/projectNav.mjs.
import { walk as walkAst } from 'estree-walker';
import { parseToAst } from '../../packages/ast/parse.mjs';

/** Map of local binding name -> `{specifier, imported}` for every static import. `imported` is
 * 'default', '*' (namespace) or the exported name. */
function importBindings(ast) {
  const map = new Map();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers) {
      const imported = spec.type === 'ImportDefaultSpecifier' ? 'default'
        : spec.type === 'ImportNamespaceSpecifier' ? '*'
          : (spec.imported.name ?? spec.imported.value);
      map.set(spec.local.name, { specifier: node.source.value, imported });
    }
  }
  return map;
}

function jsxRoot(nameNode) {
  let n = nameNode;
  while (n && n.type === 'JSXMemberExpression') n = n.object;
  return n && n.type === 'JSXIdentifier' ? n : null;
}

/**
 * Every reference candidate in `source`, in source order:
 * `{name, kind: 'import'|'jsx'|'dynamic', start, end, line, column, specifier, imported, reason}`.
 * `start`/`end` are character offsets of the identifier (for 'dynamic' the argument expression).
 * `specifier`/`imported` are set for 'import' and 'jsx' references backed by an import; a 'jsx'
 * reference to a name that is not imported, and every 'dynamic' one, carries a plain-language
 * `reason` and no specifier (they cannot be followed statically).
 *
 * @param {string} source TypeScript or JSX source text.
 * @returns {object[]} The reference candidates, in source order.
 */
export function collectReferences(source) {
  const ast = parseToAst(source);
  const bindings = importBindings(ast);
  const out = [];
  const at = (node) => ({ start: node.range[0], end: node.range[1], line: node.loc.start.line, column: node.loc.start.column + 1 });

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers) {
      const b = bindings.get(spec.local.name);
      out.push({ name: spec.local.name, kind: 'import', ...at(spec.local), specifier: b.specifier, imported: b.imported });
    }
  }
  walkAst(ast, {
    enter(node) {
      if (node.type === 'JSXOpeningElement') {
        const root = jsxRoot(node.name);
        if (!root || !/^[A-Z]/.test(root.name)) return;
        const b = bindings.get(root.name);
        if (b) out.push({ name: root.name, kind: 'jsx', ...at(root), specifier: b.specifier, imported: b.imported });
        else out.push({ name: root.name, kind: 'jsx', ...at(root), specifier: null, imported: null, reason: `${root.name} is not imported here (it is defined in this file or chosen at run time), so there is no file to open.` });
      } else if (node.type === 'ImportExpression') {
        const arg = node.source;
        const literal = arg.type === 'Literal' && typeof arg.value === 'string';
        out.push({
          name: literal ? arg.value : source.slice(arg.range[0], arg.range[1]), kind: 'dynamic', ...at(arg), specifier: null, imported: null,
          reason: literal ? 'Loaded at run time with import(), which is not followed statically.' : 'The module is computed at run time, so there is no file to open.',
        });
      }
    },
  });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Where module `source` gets its export `name` ('default' for the default export) from:
 * - `{kind: 'local'}`: declared in this module;
 * - `{kind: 'reexport', source, importedName}`: `export { X } from './X'`, `export { default as X }
 *   from ...`, `export * as ns from ...` (importedName '*'), or an imported binding exported again;
 * - `{kind: 'star', sources}`: not named directly, but `export * from` these modules might supply it;
 * - `null`: not exported.
 *
 * @param {string} source Text of the module.
 * @param {string} name Export name (`'default'` for the default export).
 * @returns {object|null} `{kind:'local'}`, `{kind:'reexport', source, importedName}` or `{kind:'star', sources}`: where the export comes from, or `null` when the module does not export it.
 */
export function exportOrigin(source, name) {
  const ast = parseToAst(source);
  const bindings = importBindings(ast);
  const stars = [];
  const viaBinding = (local) => {
    const b = bindings.get(local);
    return b ? { kind: 'reexport', source: b.specifier, importedName: b.imported } : { kind: 'local' };
  };
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      const decl = node.declaration;
      if (decl) {
        const names = [];
        if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) if (d.id.type === 'Identifier') names.push(d.id.name);
          // destructured exports: scan shallow object/array patterns
          for (const d of decl.declarations) if (d.id.type !== 'Identifier') collectPattern(d.id, names);
        } else if (decl.id?.name) names.push(decl.id.name);
        if (names.includes(name)) return { kind: 'local' };
      }
      for (const spec of node.specifiers || []) {
        const exported = spec.exported?.name ?? spec.exported?.value;
        if (exported !== name) continue;
        const local = spec.local?.name ?? spec.local?.value;
        if (node.source) return { kind: 'reexport', source: node.source.value, importedName: local };
        return viaBinding(local);
      }
    } else if (node.type === 'ExportDefaultDeclaration' && name === 'default') {
      return node.declaration.type === 'Identifier' ? viaBinding(node.declaration.name) : { kind: 'local' };
    } else if (node.type === 'ExportAllDeclaration') {
      const exported = node.exported?.name ?? node.exported?.value;
      if (exported) { if (exported === name) return { kind: 'reexport', source: node.source.value, importedName: '*' }; }
      else stars.push(node.source.value);
    }
  }
  return stars.length && name !== 'default' ? { kind: 'star', sources: stars } : null;
}

function collectPattern(node, out) {
  if (!node) return;
  if (node.type === 'Identifier') out.push(node.name);
  else if (node.type === 'ObjectPattern') for (const p of node.properties) collectPattern(p.type === 'RestElement' ? p.argument : p.value, out);
  else if (node.type === 'ArrayPattern') for (const e of node.elements) collectPattern(e, out);
  else if (node.type === 'AssignmentPattern') collectPattern(node.left, out);
  else if (node.type === 'RestElement') collectPattern(node.argument, out);
}
