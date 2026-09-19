// Scope/binding link graph (#223 parity): for ONE element of a page, which of the page's in-scope
// names (destructured props, useState values/setters) flow into which of that element's props, and
// which props the child component declares but nobody passes. Pure and deterministic -- no I/O, no
// LLM. The caller supplies the page source and (optionally) the source of the file the child
// component is imported from; cross-file resolution stays the caller's job (see ui/server).
import {
  parseJsx, parseJsxTree, collectScopeDeclarations, collectBareIdentifierUsages,
  findImportOfName, declaredPropNames,
} from '../ast/index.mjs';

/** Names from `scope` (a Set) referenced by an attribute value. */
function referencedNames(prop, scope) {
  if (prop.kind === 'identifier') return scope.has(prop.value) ? [prop.value] : [];
  if (prop.kind !== 'expression' && prop.kind !== 'spread') return [];
  let ast;
  try {
    ast = parseJsx(`(${prop.value});`);
  } catch {
    return [];
  }
  return [...new Set(collectBareIdentifierUsages(ast, scope).map((h) => h.name))];
}

/** Declared props of `tag` from its file's source: `{closed, names}` or null when unknown. A compound
 * tag (`Foo.Bar`) is looked up as `Bar` (the sub-component) in the imported file. */
function resolveDeclared(pageAst, tag, childSource) {
  if (childSource == null) return null;
  const [rootName, ...rest] = tag.split('.');
  if (rest.length > 0) return declaredPropNames(childSource, rest[rest.length - 1], false);
  const imported = findImportOfName(pageAst, rootName);
  return declaredPropNames(childSource, rootName, imported ? imported.isDefault : false);
}

/** The import backing a tag's root name (`{source, isDefault}`) or null -- for callers that must
 * fetch the child component's source before calling `buildScopeLinks`. */
export function importOfTag(pageSource, tag) {
  return findImportOfName(parseJsx(pageSource), tag.split('.')[0]);
}

/**
 * Build the scope/binding graph for element `nodeId`.
 *
 * Returns `{nodeId, tag, isCustomComponent, scope, links, spreads, childProps, undeclared,
 * suggestions, unusedScope, childPropsResolved}`:
 * - `scope`: `[{name, kind: 'prop'|'state'|'setter'}]` page declarations available to the element.
 * - `links`: one per named attribute `{prop, valueKind, text, from: [{name, kind}]}`; `valueKind` is
 *   'literal' | 'identifier' | 'expression'. `from` is empty when the value uses no scope name.
 * - `spreads`: `[{text, from}]` for `{...x}` attributes.
 * - `childProps`: (only when the child's declared props are a closed, known set) `[{name, status}]`,
 *   status 'bound' (passed), 'spread' (maybe covered by a spread) or 'unbound'; else null.
 * - `undeclared`: passed props the (closed) child doesn't declare.
 * - `suggestions`: unbound child props with a same-named in-scope declaration (an auto-map candidate).
 * - `unusedScope`: scope names referenced by no element's attributes anywhere in the page.
 * Throws an Error with `code: 'NO_SUCH_NODE'` for an unknown id.
 */
export function buildScopeLinks(pageSource, nodeId, { childSource } = {}) {
  const ast = parseJsx(pageSource);
  const { byId } = parseJsxTree(pageSource);
  const node = byId.get(nodeId);
  if (!node) {
    const err = new Error(`No such node "${nodeId}".`);
    err.code = 'NO_SUCH_NODE';
    throw err;
  }
  const scope = collectScopeDeclarations(ast);
  const scopeNames = new Set(scope.map((d) => d.name));
  const kindOf = new Map(scope.map((d) => [d.name, d.kind]));
  const toFrom = (names) => names.map((name) => ({ name, kind: kindOf.get(name) }));

  const links = [];
  const spreads = [];
  for (const p of node.props) {
    const from = toFrom(referencedNames(p, scopeNames));
    if (p.kind === 'spread') {
      spreads.push({ text: p.value, from });
    } else {
      const valueKind = p.kind === 'identifier' ? 'identifier' : p.kind === 'expression' ? 'expression' : 'literal';
      links.push({ prop: p.name, valueKind, text: String(p.value), from });
    }
  }

  const used = new Set();
  for (const rec of byId.values()) for (const p of rec.props) for (const n of referencedNames(p, scopeNames)) used.add(n);
  const unusedScope = scope.filter((d) => !used.has(d.name)).map((d) => d.name);

  let childProps = null;
  let undeclared = [];
  let suggestions = [];
  const declared = node.isCustomComponent ? resolveDeclared(ast, node.tag, childSource) : null;
  if (declared && declared.closed) {
    const passed = new Set(links.map((l) => l.prop));
    childProps = [...declared.names].map((name) => ({
      name,
      status: passed.has(name) ? 'bound' : spreads.length > 0 ? 'spread' : 'unbound',
    }));
    undeclared = [...passed].filter((n) => !declared.names.has(n) && n !== 'key' && n !== 'ref');
    suggestions = childProps.filter((c) => c.status === 'unbound' && scopeNames.has(c.name)).map((c) => c.name);
  }

  return {
    nodeId,
    tag: node.tag,
    isCustomComponent: node.isCustomComponent,
    scope,
    links,
    spreads,
    childProps,
    undeclared,
    suggestions,
    unusedScope,
    childPropsResolved: Boolean(declared && declared.closed),
  };
}
