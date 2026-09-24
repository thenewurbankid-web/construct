// AST package: domain purity allowlist detection (#506), additive alongside the existing
// DOMAIN-001 denylist in packages/core/architecture-enforcer.mjs.
//
// #492 showed DOMAIN-001's approach -- collectBareIdentifierUsages(ast, new
// Set(['fetch','window','document',...])) -- false-positives on a parameter or local variable
// that merely happens to share a name with one of those globals, because it does no scope
// analysis at all: any Identifier node named "document" counts, including its own binding
// site. #506 asks for an allowlist instead: a domain function may reference only
//   - its own parameters and destructured bindings -- generalized here to "any name the file
//     itself locally binds" (a `const`/`let`/`var`, a sibling function/class declaration, a
//     catch/for binding), since that is still the function's own code, not an external
//     effect -- not just a first-level function parameter
//   - type-only imports (`import type {...}` or an inline `import { type X }` specifier) --
//     these have no runtime existence, so referencing one is never an effect
//   - a fixed, small list of JS built-in globals (BUILTIN_GLOBALS below)
// Anything else referenced as a real value -- a plain (non-type) import used as a value, or a
// genuine outer global like `document`/`window`/`fetch`/anything else never bound in the file
// -- is the violation, regardless of what it is named.
//
// Detection is a whole-file scope heuristic, not a fully sound per-scope resolver: every name
// bound *anywhere* in the file counts as "local", the same heuristic style
// jsxScope.mjs's collectComponentScopeNames already uses in this package (deliberately not
// tracking a precise scope chain). A false negative is possible across two sibling functions
// that happen to reuse the same parameter name for different things; a false positive from
// that shape is not (the point #492 exists to fix).
import { walkAst, isNonUsagePosition } from './walk.mjs';

/** JS built-in globals a pure domain function may reference without it being an external
 * effect -- deliberately narrow: only globals whose use is itself a pure computation
 * (numeric/string/collection primitives, structured data, error construction). Never a global
 * that reaches outside the process or the DOM/BOM (no `console`, `process`, `Buffer`,
 * `require`, timers, `document`/`window`/`fetch`/... -- DOMAIN-001 already denies those by
 * name, and the allowlist here denies everything not on this list regardless of name). */
export const BUILTIN_GLOBALS = new Set([
  'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean',
  'Promise', 'Map', 'Set', 'Symbol', 'Error',
]);

// Keys under which a child node is a *type*, not a value -- skipped regardless of the child
// node's own type, so `x as Foo` / `x satisfies Foo` (whose `typeAnnotation` field holds a
// plain TSTypeReference, not a wrapping TSTypeAnnotation) are covered the same way as a
// parameter's `: Foo` annotation (whose `typeAnnotation` field IS a TSTypeAnnotation).
const TYPE_POSITION_KEYS = new Set(['typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'superTypeParameters', 'superTypeArguments']);

// Whole-declaration type-only constructs -- reached via an ordinary 'body'/'declaration' key,
// so TYPE_POSITION_KEYS above doesn't cover them; skipped by node type instead.
const TYPE_ONLY_DECLARATION_TYPES = new Set(['TSInterfaceDeclaration', 'TSTypeAliasDeclaration']);

/** Every name a parameter/destructuring pattern binds, recursively -- `{ a: { b, c }, ...rest }`
 * binds `b`, `c`, `rest`; a default value's own references aren't bindings, so `= x` in
 * `{ a = x }` doesn't add `x`. */
function namesFromPattern(pattern, names) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      names.add(pattern.name);
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        namesFromPattern(prop.type === 'RestElement' ? prop.argument : prop.value, names);
      }
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements) namesFromPattern(el, names);
      break;
    case 'RestElement':
      namesFromPattern(pattern.argument, names);
      break;
    case 'AssignmentPattern':
      namesFromPattern(pattern.left, names);
      break;
    default:
      break;
  }
}

/**
 * Every name the file binds anywhere: function/arrow/function-expression parameters
 * (recursively destructured), variable declarators (including destructuring, and `for`/`catch`
 * bindings, which are declarators/patterns too), and named function/class declarations or
 * expressions (so a sibling helper or a recursive self-call resolves). Whole-file, not
 * scope-chain-precise -- see the module doc comment.
 *
 * @param {object} ast A parsed Program.
 * @returns {Set<string>} Every locally-bound name.
 *
 * @example
 * collectLocallyBoundNames(parseToAst('export function f(document){ return document; }'));
 * // => Set(['f', 'document'])
 */
export function collectLocallyBoundNames(ast) {
  const names = new Set();
  walkAst(ast, {
    enter(node) {
      if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
        for (const p of node.params) namesFromPattern(p, names);
        if (node.id?.name) names.add(node.id.name);
      } else if (node.type === 'ArrowFunctionExpression') {
        for (const p of node.params) namesFromPattern(p, names);
      } else if (node.type === 'VariableDeclarator') {
        namesFromPattern(node.id, names);
      } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        if (node.id?.name) names.add(node.id.name);
      } else if (node.type === 'CatchClause' && node.param) {
        namesFromPattern(node.param, names);
      }
    },
  });
  return names;
}

/** Local names bound by a *type-only* import -- the whole declaration is `import type {...}`,
 * or an individual specifier is (`import { type Foo, Bar } from '...'`). */
function collectTypeOnlyImportNames(ast) {
  const names = new Set();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers) {
      if ((node.importKind === 'type' || spec.importKind === 'type') && spec.local?.name) names.add(spec.local.name);
    }
  }
  return names;
}

/** The typed-contracts factory a domain unit is defined through (#502). It is Construct's own boundary type, not an effect:
 * DOMAIN-002 lets the file import and call it, so `defineDomain(...)` and the allowlist rule can both be on (#619). */
const DOMAIN_FACTORY = 'defineDomain';

/** Local names bound by a value import of `defineDomain` from a typed-contracts module (`@line/construct-core/typed-contracts`,
 * or the relative path of the vendored copy). Any other module exporting the same name is not trusted. */
function collectDomainFactoryNames(ast) {
  const names = new Set();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || node.importKind === 'type' || !/typed-contracts(?:\/index(?:\.ts)?)?$/.test(String(node.source.value))) continue;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier' && spec.importKind !== 'type' && (spec.imported?.name ?? spec.imported?.value) === DOMAIN_FACTORY && spec.local?.name) names.add(spec.local.name);
    }
  }
  return names;
}

/**
 * Every reference in `ast` to a free identifier the domain-purity allowlist does not cover:
 * not one of the file's own locally-bound names (collectLocallyBoundNames), not a type-only
 * import, and not a built-in global (BUILTIN_GLOBALS). This is what DOMAIN-002
 * (packages/core/architecture-enforcer.mjs) flags -- a genuine `document.querySelector(...)`
 * call or a value import used as a value both count, regardless of what they're named; a
 * parameter or local variable merely named `document` does not (#492). Type positions (a type
 * annotation, an interface/type-alias body, a generic type argument) are skipped entirely --
 * referencing a type name is never a runtime effect. Import/export specifier lists and
 * non-computed member/object keys are skipped too (not a "usage" position at all -- same
 * exclusion collectBareIdentifierUsages relies on, isNonUsagePosition).
 *
 * @param {object} ast A parsed Program.
 * @returns {{name: string, index: number}[]} Each disallowed reference, sorted by position.
 *
 * @example
 * collectImpureDomainReferences(parseToAst('export function f(document){ return document; }'));
 * // => [] -- `document` here is the function's own parameter, not the DOM global.
 * @example
 * collectImpureDomainReferences(parseToAst('export function f(){ return document.title; }'));
 * // => [{ name: 'document', index: 26 }] -- a genuine free reference to the global.
 */
export function collectImpureDomainReferences(ast) {
  const locallyBound = collectLocallyBoundNames(ast);
  const typeOnlyImports = collectTypeOnlyImportNames(ast);
  const factoryNames = collectDomainFactoryNames(ast);
  const hits = [];

  walkAst(ast, {
    enter(node, parent, key) {
      if (TYPE_ONLY_DECLARATION_TYPES.has(node.type) || (typeof key === 'string' && TYPE_POSITION_KEYS.has(key))) {
        this.skip();
        return;
      }
      if (isNonUsagePosition(node, parent, key)) {
        this.skip();
        return;
      }
      if (node.type !== 'Identifier') return;
      if (locallyBound.has(node.name) || typeOnlyImports.has(node.name) || factoryNames.has(node.name) || BUILTIN_GLOBALS.has(node.name)) return;
      hits.push({ name: node.name, index: node.range[0] });
    },
  });

  return hits.sort((a, b) => a.index - b.index);
}
