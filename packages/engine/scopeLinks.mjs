// Scope/binding link graph (#223 parity): for ONE element of a page, which of the page's in-scope
// names (destructured props, useState values/setters) flow into which of that element's props, and
// which props the child component declares but nobody passes. Pure and deterministic -- no I/O, no
// LLM. The caller supplies the page source and (optionally) the source of the file the child
// component is imported from; cross-file resolution stays the caller's job (see ui/server).
//
// #528 -- widens the scope itself (strictly additive to the above -- 'prop'/'state'/'setter' keep
// their exact existing meaning) with two more real scope sources, both gated on the same real
// reachability boundary PAGE-006/HOOK-002 already enforce (a sanctioned hook import from a
// `hooks?/` path), reusing that logic (isProviderHookName/isTrackedStateHookName) rather than
// re-implementing it:
//   - 'provider': a field a reachable ProviderUnit exposes via useProvider() (provider.ts) -- the
//     caller supplies the Provider hook's own file source (providerSources), same cross-file-lookup
//     shape as the existing childSource, since the field names live in that file, not the page's.
//   - 'unit-output': a local binding already destructured from an already-called tracked-state hook
//     (trackedState.ts, HOOK-001) in the open page -- no cross-file lookup needed, the names are
//     already right there in the page's own source, exactly like a useState pair is today.
import {
  parseJsx, parseJsxTree, collectScopeDeclarations, collectBareIdentifierUsages,
  findImportOfName, declaredPropNames, findTypeMembers, walkAst, parseTsSource, ts,
} from '../../packages/ast/index.mjs';
import { isProviderHookName, isTrackedStateHookName } from '../core/architecture-enforcer.mjs';

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

/**
 * The import backing a tag's root name (`{source, isDefault}`) or null -- for callers that must
 * fetch the child component's source before calling `buildScopeLinks`.
 *
 * @param {string} pageSource Source of the page.
 * @param {string} tag JSX tag, possibly dotted (`Ui.Button`); its root name is looked up.
 * @returns {{source:string, isDefault:boolean}|null} The import that backs the tag, or `null` for a local or unimported name.
 */
export function importOfTag(pageSource, tag) {
  return findImportOfName(parseJsx(pageSource), tag.split('.')[0]);
}

/** The imported (not local/aliased) name for a named/default import specifier, or `null` for a
 * namespace import -- same conservative shape architecture-enforcer.mjs's own
 * importedSpecifierNames uses, kept local here so this module doesn't need a second import from it. */
function importedSpecifierName(spec) {
  if (spec.type === 'ImportSpecifier') return spec.imported?.name ?? spec.imported?.value ?? spec.local?.name ?? null;
  if (spec.type === 'ImportDefaultSpecifier') return spec.local?.name ?? null;
  return null; // ImportNamespaceSpecifier
}

/**
 * Provider hooks reachable from the page's own top-level imports: one `{source, hookName}` per
 * specifier, from a `hooks?/` path, whose imported name is a real Provider hook name
 * (`use<Name>Provider`) -- the same reachability boundary PAGE-006 already enforces. Exported (#529)
 * so a caller resolving `providerSources` across files (ui/server's getScopeLinks) can reuse this
 * exact detection instead of re-deriving the naming-convention check a third time.
 *
 * @param {object} ast The page's parsed AST (`parseJsx(pageSource)`).
 * @returns {{source:string, hookName:string}[]} One entry per reachable Provider hook import.
 */
export function providerHookImports(ast) {
  const hits = [];
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || !/hooks?\//.test(node.source.value)) continue;
    for (const spec of node.specifiers) {
      const importedName = importedSpecifierName(spec);
      if (importedName && isProviderHookName(importedName)) hits.push({ source: node.source.value, hookName: importedName });
    }
  }
  return hits;
}

/** Local names bound to a tracked-state hook import (`use<Name>State`), from a `hooks?/` path --
 * same reachability boundary as providerHookImports, for PAGE-006's other sanctioned hook shape. */
function trackedStateHookLocalNames(ast) {
  const names = new Set();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || !/hooks?\//.test(node.source.value)) continue;
    for (const spec of node.specifiers) {
      const importedName = importedSpecifierName(spec);
      if (importedName && isTrackedStateHookName(importedName)) names.add(spec.local.name);
    }
  }
  return names;
}

/**
 * The field names a Provider hook exposes via `useProvider()`, read from the hook's own file
 * source: finds `defineProvider<Props, Value>(...)`'s second type argument (following a local
 * `const XProvider = defineProvider<...>(...)` binding when the export is `export const
 * use<Name>Provider = XProvider.useProvider`, or the inline call directly), then that Value type's
 * member names (`findTypeMembers`, the same TS-compiler-API introspection `declaredPropNames`
 * already uses for a child component's Props).
 *
 * @param {string} hookSource Source of the file the Provider hook is exported from.
 * @param {string} hookName The hook's exported name (`use<Name>Provider`).
 * @returns {string[]|null} Field names, or `null` when the hook/its Value type can't be resolved
 *   (unknown shape, open/index-signature type) -- callers treat `null` as "don't add sources".
 */
export function providerExposedFields(hookSource, hookName) {
  let sourceFile;
  try {
    sourceFile = parseTsSource(hookSource, 'provider.tsx');
  } catch {
    return null;
  }

  const defineProviderValueType = (expr) => {
    if (!expr) return null;
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'defineProvider' && expr.typeArguments?.length >= 2) {
      return expr.typeArguments[1];
    }
    if (ts.isIdentifier(expr)) {
      let found = null;
      const visit = (node) => {
        if (found) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expr.text && node.initializer) {
          found = defineProviderValueType(node.initializer);
          if (found) return;
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      return found;
    }
    return null;
  };

  let valueTypeNode = null;
  const visitExport = (node) => {
    if (valueTypeNode) return;
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === hookName
      && node.initializer && ts.isPropertyAccessExpression(node.initializer) && node.initializer.name.text === 'useProvider'
    ) {
      valueTypeNode = defineProviderValueType(node.initializer.expression);
      return;
    }
    ts.forEachChild(node, visitExport);
  };
  visitExport(sourceFile);
  if (!valueTypeNode) return null;

  if (ts.isTypeLiteralNode(valueTypeNode)) {
    if (valueTypeNode.members.some((m) => ts.isIndexSignatureDeclaration(m))) return null;
    const names = [];
    for (const m of valueTypeNode.members) if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) names.push(m.name.text);
    return names;
  }
  if (ts.isTypeReferenceNode(valueTypeNode) && ts.isIdentifier(valueTypeNode.typeName)) {
    const members = findTypeMembers(hookSource, valueTypeNode.typeName.text);
    return members && members.closed ? [...members.names] : null;
  }
  return null;
}

/** Local names already destructured from an already-called tracked-state hook in the page
 * (`const {a, b} = useXState()`, or `const {a, ...rest} = useXState()`), in source order --
 * `hookLocalNames` is the set of locally-bound names that really are a sanctioned tracked-state
 * hook import (trackedStateHookLocalNames). Mirrors namesFromParams'/useStateNames' own shape in
 * packages/ast/jsxScope.mjs, kept local here since it walks a CallExpression's result, not a
 * function's own parameters or a bare `useState` call. */
function collectTrackedStateOutputs(ast, hookLocalNames) {
  const hits = [];
  walkAst(ast, {
    enter(node) {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'ObjectPattern') return;
      const init = node.init;
      if (!init || init.type !== 'CallExpression' || init.callee.type !== 'Identifier') return;
      if (!hookLocalNames.has(init.callee.name)) return;
      const names = [];
      for (const prop of node.id.properties) {
        if (prop.type === 'Property' && prop.value.type === 'Identifier') names.push(prop.value.name);
        else if (prop.type === 'RestElement' && prop.argument.type === 'Identifier') names.push(prop.argument.name);
      }
      hits.push({ at: node.range[0], names });
    },
  });
  hits.sort((a, b) => a.at - b.at);
  return hits.flatMap((h) => h.names);
}

/**
 * Build the scope/binding graph for element `nodeId`.
 *
 * Returns `{nodeId, tag, isCustomComponent, scope, links, spreads, childProps, undeclared,
 * suggestions, unusedScope, childPropsResolved}`:
 * - `scope`: `[{name, kind: 'prop'|'state'|'setter'|'provider'|'unit-output'}]` page declarations
 *   available to the element -- 'provider' (a reachable Provider's exposed field, #528, only added
 *   when `providerSources` resolves it) and 'unit-output' (a name already destructured from an
 *   already-called tracked-state hook) alongside the original 'prop'/'state'/'setter' set.
 * - `links`: one per named attribute `{prop, valueKind, text, from: [{name, kind}]}`; `valueKind` is
 *   'literal' | 'identifier' | 'expression'. `from` is empty when the value uses no scope name.
 * - `spreads`: `[{text, from}]` for `{...x}` attributes.
 * - `childProps`: (only when the child's declared props are a closed, known set) `[{name, status}]`,
 *   status 'bound' (passed), 'spread' (maybe covered by a spread) or 'unbound'; else null.
 * - `undeclared`: passed props the (closed) child doesn't declare.
 * - `suggestions`: unbound child props with a same-named in-scope declaration (an auto-map candidate).
 * - `unusedScope`: scope names referenced by no element's attributes anywhere in the page.
 * Throws an Error with `code: 'NO_SUCH_NODE'` for an unknown id.
 *
 * @param {string} pageSource Source of the page.
 * @param {string} nodeId Id of the JSX element (from the JSX tree).
 * @param {{childSource?: string, providerSources?: Record<string,string>}} [options] Source of the
 *   child component, so its declared props can be checked; `providerSources` maps a reachable
 *   Provider hook import's source path OR its imported hook name to that hook's own file source, so
 *   its exposed fields can be resolved (#528) -- omitted or unresolved entries simply add no
 *   'provider' scope for that import, exactly like an unresolved `childSource` leaves `childProps` null.
 * @returns {object} The scope and binding graph described above.
 * @throws {Error} With `code: 'NO_SUCH_NODE'` for an unknown id.
 */
export function buildScopeLinks(pageSource, nodeId, { childSource, providerSources } = {}) {
  const ast = parseJsx(pageSource);
  const { byId } = parseJsxTree(pageSource);
  const node = byId.get(nodeId);
  if (!node) {
    const err = new Error(`No such node "${nodeId}".`);
    err.code = 'NO_SUCH_NODE';
    throw err;
  }
  const scope = collectScopeDeclarations(ast);

  // #528 -- widen `scope` with reachable Provider fields and already-called tracked-state-hook
  // outputs, strictly additive: existing 'prop'/'state'/'setter' entries are untouched, and a name
  // already declared one of those ways is never overridden by a same-named provider/unit-output one.
  const declaredNames = new Set(scope.map((d) => d.name));
  for (const { source, hookName } of providerHookImports(ast)) {
    const hookSource = providerSources?.[source] ?? providerSources?.[hookName];
    if (!hookSource) continue;
    const fields = providerExposedFields(hookSource, hookName);
    if (!fields) continue;
    for (const name of fields) {
      if (declaredNames.has(name)) continue;
      declaredNames.add(name);
      scope.push({ name, kind: 'provider' });
    }
  }
  const trackedHookNames = trackedStateHookLocalNames(ast);
  if (trackedHookNames.size > 0) {
    for (const name of collectTrackedStateOutputs(ast, trackedHookNames)) {
      if (declaredNames.has(name)) continue;
      declaredNames.add(name);
      scope.push({ name, kind: 'unit-output' });
    }
  }

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
