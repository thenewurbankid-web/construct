// Epic #223 -- read a machine's typed context from source (AST only).
//
// A machine's context lives in two places that must stay in step: the runtime
// initial values (`createMachine({ context: { quantity: 1 } })`) and, when the
// file is typed the way `construct workflow` generates it, a `types.context`
// reference to an interface/type alias in the same file. This module finds
// both from the typescript-estree AST; nothing is executed.
const nameOf = (key) => (key.type === 'Identifier' ? key.name : String(key.value));

/** The `setup({...})` argument object when the machine is `setup(...).createMachine(...)`. */
export function setupObjectOf(call) {
  const c = call.callee;
  if (c.type !== 'MemberExpression' || c.object.type !== 'CallExpression') return null;
  const inner = c.object;
  if (inner.callee.type !== 'Identifier' || inner.callee.name !== 'setup') return null;
  const arg = inner.arguments[0];
  return arg && arg.type === 'ObjectExpression' ? arg : null;
}

function prop(obj, name) {
  return obj.properties.find((p) => p.type === 'Property' && !p.computed && nameOf(p.key) === name);
}

const declarationsOf = (ast) =>
  ast.body.map((n) => (n.type === 'ExportNamedDeclaration' && n.declaration ? n.declaration : n));

/**
 * Locate the type that describes the context: `setup({ types: {} as { context: X } })`
 * where X is an interface / type-literal alias in this file, or an inline literal.
 * @returns {{ members: {name:string, typeText:string, node:object}[], body: object, kind: 'interface'|'literal' } | null}
 */
export function contextTypeInfo(ast, setupObj, source) {
  const types = setupObj && prop(setupObj, 'types');
  const cast = types && types.value;
  const lit = cast && cast.type === 'TSAsExpression' && cast.typeAnnotation.type === 'TSTypeLiteral' ? cast.typeAnnotation : null;
  if (!lit) return null;
  const ctx = lit.members.find((m) => m.type === 'TSPropertySignature' && nameOf(m.key) === 'context');
  const ann = ctx && ctx.typeAnnotation && ctx.typeAnnotation.typeAnnotation;
  if (!ann) return null;
  let body = null;
  let kind = 'literal';
  if (ann.type === 'TSTypeLiteral') body = ann;
  else if (ann.type === 'TSTypeReference' && ann.typeName.type === 'Identifier') {
    for (const d of declarationsOf(ast)) {
      if (d.type === 'TSInterfaceDeclaration' && d.id.name === ann.typeName.name) {
        body = d.body;
        kind = 'interface';
      } else if (d.type === 'TSTypeAliasDeclaration' && d.id.name === ann.typeName.name && d.typeAnnotation.type === 'TSTypeLiteral') {
        body = d.typeAnnotation;
        kind = 'literal';
      }
    }
  }
  if (!body) return null;
  const list = body.type === 'TSInterfaceBody' ? body.body : body.members;
  const members = list
    .filter((m) => m.type === 'TSPropertySignature' && !m.computed)
    .map((m) => ({ name: nameOf(m.key), typeText: m.typeAnnotation ? source.slice(m.typeAnnotation.typeAnnotation.range[0], m.typeAnnotation.typeAnnotation.range[1]) : 'unknown', node: m }));
  return { members, body, kind, list };
}
