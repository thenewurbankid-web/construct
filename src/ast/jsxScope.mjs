// AST package: what a page component has in scope, and what a child component declares (#173).
//
// Deliberately single-file/heuristic: the page's own destructured props and top-level `useState`
// bindings; a child's declared props from its first parameter (an object pattern's keys, or a typed
// `props: FooProps` resolved via the TypeScript compiler API). No cross-file *resolution* here -- the
// caller finds the child file and passes its source in.
import { walkAst } from './walk.mjs';
import { parseJsx } from './jsxParse.mjs';
import { parseTsSource } from './parse.mjs';
import { ts } from './tsNodes.mjs';

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression']);

// Methods are FunctionExpression nodes in estree; only free-standing function expressions count.
function isMethodBody(node, parent) {
  if (node.type !== 'FunctionExpression' || !parent) return false;
  if (parent.type === 'MethodDefinition' || parent.type === 'TSAbstractMethodDefinition') return true;
  return parent.type === 'Property' && (parent.method || parent.kind !== 'init');
}

function namesFromParams(params, names) {
  for (const param of params) {
    if (param.type === 'ObjectPattern') {
      for (const prop of param.properties) {
        if (prop.type === 'Property' && prop.value.type === 'Identifier') names.add(prop.value.name);
        else if (prop.type === 'RestElement' && prop.argument.type === 'Identifier') names.add(prop.argument.name);
      }
    } else if (param.type === 'Identifier') {
      names.add(param.name);
    }
  }
}

function useStateNames(declarator) {
  const init = declarator.init;
  if (init?.type !== 'CallExpression' || declarator.id.type !== 'ArrayPattern') return [];
  const callee = init.callee;
  const calleeName = callee.type === 'Identifier'
    ? callee.name
    : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name : null;
  if (calleeName !== 'useState') return [];
  return declarator.id.elements.filter((el) => el?.type === 'Identifier').map((el) => el.name);
}

/** In-scope names of a page: every function's destructured/plain parameter names plus every
 * `const [value, setValue] = useState(...)` binding, in source order, de-duplicated. */
export function collectComponentScopeNames(ast) {
  const hits = [];
  walkAst(ast, {
    enter(node, parent) {
      if (FUNCTION_TYPES.has(node.type) && !isMethodBody(node, parent)) {
        const names = new Set();
        namesFromParams(node.params, names);
        hits.push({ at: node.range[0], names: [...names] });
      } else if (node.type === 'VariableDeclarator') {
        hits.push({ at: node.range[0], names: useStateNames(node) });
      }
    },
  });
  hits.sort((a, b) => a.at - b.at);
  return [...new Set(hits.flatMap((h) => h.names))];
}

/** How a module-level import binds `localName`: `{source, isDefault}`, or `null` if it isn't imported. */
export function findImportOfName(ast, localName) {
  let found = null;
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers) {
      if (spec.local.name !== localName) continue;
      found = { source: node.source.value, isDefault: spec.type === 'ImportDefaultSpecifier' };
    }
  }
  return found;
}

function findLocalFunction(body, name) {
  for (const node of body) {
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) return node;
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === name && (d.init?.type === 'ArrowFunctionExpression' || d.init?.type === 'FunctionExpression')) {
          return d.init;
        }
      }
    }
  }
  return null;
}

/** The function backing a component export: for a named import, a same-named function declaration or
 * `const Name = (...) => ...` (top-level or inside `export ...`); for a default import, the default export. */
function findComponentFunction(ast, tagName, isDefault) {
  const body = ast.body;
  if (isDefault) {
    for (const node of body) {
      if (node.type !== 'ExportDefaultDeclaration') continue;
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration' || decl.type === 'ArrowFunctionExpression' || decl.type === 'FunctionExpression') return decl;
      if (decl.type === 'Identifier') return findLocalFunction(body, decl.name);
    }
    return null;
  }
  const direct = findLocalFunction(body, tagName);
  if (direct) return direct;
  for (const node of body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const found = findLocalFunction([node.declaration], tagName);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Member names of a TS interface / type-literal alias named `typeName` declared in `source`:
 * `{closed: true, names}`, `{closed: false, names: empty}` if it has an index signature (open -- can't
 * enumerate), or `null` if not found. Uses the TypeScript compiler API, the canonical parser for type syntax.
 */
export function findTypeMembers(source, typeName) {
  const sourceFile = parseTsSource(source, 'child.tsx');
  let result = null;
  const visit = (node) => {
    if (result) return;
    const isInterface = ts.isInterfaceDeclaration(node) && node.name.text === typeName;
    const isTypeLiteralAlias = ts.isTypeAliasDeclaration(node) && node.name.text === typeName && ts.isTypeLiteralNode(node.type);
    if (isInterface || isTypeLiteralAlias) {
      const members = isInterface ? node.members : node.type.members;
      if (members.some((m) => ts.isIndexSignatureDeclaration(m))) {
        result = { closed: false, names: new Set() };
      } else {
        const names = new Set();
        for (const m of members) {
          if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) names.add(m.name.text);
        }
        result = { closed: true, names };
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function declaredNamesFromFunction(fn, childSource) {
  const param = fn.params[0];
  if (!param) return { closed: true, names: new Set() };
  if (param.type === 'ObjectPattern') {
    const names = new Set();
    for (const prop of param.properties) {
      if (prop.type === 'Property' && prop.key.type === 'Identifier') names.add(prop.key.name);
    }
    return { closed: true, names };
  }
  if (param.type === 'Identifier' && param.typeAnnotation?.type === 'TSTypeAnnotation') {
    const typeRef = param.typeAnnotation.typeAnnotation;
    if (typeRef.type === 'TSTypeReference' && typeRef.typeName.type === 'Identifier') {
      const members = findTypeMembers(childSource, typeRef.typeName.name);
      if (members) return members;
    }
  }
  return null;
}

/**
 * The declared prop names of the component `tagName` defined in `childSource` (imported by default or
 * by name): `{closed, names}`, or `null` when unknown (child doesn't parse, no matching export, or its
 * first parameter's shape isn't recognized) -- callers treat null as "don't filter".
 */
export function declaredPropNames(childSource, tagName, isDefault) {
  let childAst;
  try {
    childAst = parseJsx(childSource);
  } catch {
    return null;
  }
  const fn = findComponentFunction(childAst, tagName, isDefault);
  if (!fn) return null;
  return declaredNamesFromFunction(fn, childSource);
}

/**
 * Like `collectComponentScopeNames`, but keeps what each name *is*: `{name, kind}` with kind `'prop'`
 * (a function parameter, destructured or plain), `'state'` (a `useState` value) or `'setter'` (its
 * setter). Same traversal order and de-duplication (first declaration wins) as the names-only variant.
 */
export function collectScopeDeclarations(ast) {
  const hits = [];
  walkAst(ast, {
    enter(node, parent) {
      if (FUNCTION_TYPES.has(node.type) && !isMethodBody(node, parent)) {
        const names = new Set();
        namesFromParams(node.params, names);
        hits.push({ at: node.range[0], decls: [...names].map((name) => ({ name, kind: 'prop' })) });
      } else if (node.type === 'VariableDeclarator') {
        const decls = useStateNames(node).map((name, i) => ({ name, kind: i === 0 ? 'state' : 'setter' }));
        hits.push({ at: node.range[0], decls });
      }
    },
  });
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set();
  const out = [];
  for (const d of hits.flatMap((h) => h.decls)) {
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    out.push(d);
  }
  return out;
}
