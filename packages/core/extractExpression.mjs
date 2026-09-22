// #517 (part of #500's Phase 3a) -- a real, mechanical ts-morph-shaped codemod (same
// TypeScript-compiler-API-backed approach packages/engine/tsFileMove.mjs already adopted for
// `construct refactor move/rename` per #435 -- this repo has no ts-morph dependency, the real
// existing "codemod library" IS the `typescript` package used directly, so this reuses THAT
// pattern rather than adding a second one) that takes a page/component file with a
// PAGE-008/COMPONENT-005/EXPR-004-flagged inline conditional/loop JSX block and mechanically
// extracts it into a new, properly-named `defineExpression(...)` unit under that feature's
// `expressions/` folder, rewriting the call site to use it.
//
// Two layers of the design are structural, not incidental:
//   1. The new Expression unit satisfies EXPR-005/EXPR-006 by construction (accepts children,
//      returns JSX, is built through defineExpression(...)) -- see buildExpressionSource below.
//   2. If the extracted logic renders hand-authored native markup (e.g. `<li>...</li>` inside a
//      `.map()` callback), that markup is ALSO hoisted into a new, separately-named
//      `defineComponent(...)` unit in the feature's `components/` folder, and the Expression
//      composes it by reference instead of authoring it inline -- otherwise the extraction would
//      only trade a PAGE-008 warning on the page for a brand-new EXPR-004 error on the
//      Expression, which is not a real fix. "An Expression decides, a Component renders"
//      (EXPR-004's own rationale) is honored by the codemod itself, not left for a human to
//      notice afterward.
//
// Deterministic, no LLM: every name is derived from the flagged code's own shape (the mapped
// array's property name / the tested condition's subject) with a `--name` override for when that
// can't be derived — never a generic placeholder (`Expr1`, `Extracted`, ...).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLayerGraph, classifyFile } from './architecture-graph.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { rel } from './fs.mjs';
import { assertNotFrozen } from './frozen.mjs';
import { pascalCase } from './generators.mjs';
import { parseToAst, walkAst, lineOf, collectInlineJsxLogic } from '../../packages/ast/index.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
// The vendored typed-contracts mechanism ships alongside this file (packages/core/typed-contracts/)
// whether Construct is run from this monorepo checkout (dogfooding, or against a fixture nested
// inside it) or consumed as an installed package -- either way `defineExpression`/`defineComponent`
// sit at a fixed offset from wherever THIS module itself is loaded from, so a relative import
// computed from that real, on-disk location always resolves (IMPORT-001-safe), unlike a bare
// package specifier that would need a subpath this package does not publish yet (#500 phase 1 is
// additive-only; wiring a real npm export is separate, out-of-scope packaging work).
const TYPED_CONTRACTS_INDEX = path.join(THIS_DIR, 'typed-contracts', 'index.ts');

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression']);

// Mirrors architecture-enforcer.mjs's own EXPR_GENERIC_NAMES -- a derived (or --name-overridden)
// name is rejected up front rather than silently producing an EXPR-003 violation in the very file
// this codemod exists to make clean.
const EXPR_GENERIC_NAMES = new Set([
  'if', 'switch', 'foreach', 'show', 'hide', 'when', 'cond', 'conditional', 'loop', 'map',
  'expr', 'expression', 'component', 'unit',
]);

function pascalWord(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Naive English singularization -- good enough for the common `items`/`categories`/`boxes`
 * property-naming shapes this codemod actually sees; never load-bearing for correctness (only
 * cosmetic, for the derived name), so a miss just produces a slightly odd but still valid name. */
function singularize(s) {
  if (/ies$/i.test(s)) return s.slice(0, -3) + 'y';
  if (/ses$/i.test(s)) return s.slice(0, -2);
  if (/s$/i.test(s) && !/ss$/i.test(s)) return s.slice(0, -1);
  return s;
}

/** Strip a leading `is`/`has` boolean-naming prefix when what follows is itself capitalized
 * (`isLoggedIn` -> `LoggedIn`), so a derived conditional name reads as "ShowLoggedIn" rather than
 * the redundant "ShowIsLoggedIn". Left alone when there is nothing sensible to strip. */
function stripBooleanPrefix(name) {
  const m = name.match(/^(is|has)([A-Z]\w*)$/);
  return m ? m[2] : name;
}

/** The identifier a test/array expression is "about", for naming purposes: `items` for `items` or
 * `props.items`, `isLoggedIn` for `isLoggedIn` or `!isLoggedIn`, `x` for `x()`. Returns `null` when
 * nothing nameable is found (e.g. a bare literal), which callers treat as "ask the user". */
function subjectOf(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.type === 'UnaryExpression') return subjectOf(node.argument);
  if (node.type === 'CallExpression') return subjectOf(node.callee);
  return null;
}

function isValidPropName(name) {
  return typeof name === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && name !== 'children';
}

/** The innermost function (page/component/callback) enclosing source position `pos`, so its first
 * parameter's declared type can be consulted for a best-effort type hint. Purely cosmetic (the
 * generated file still type-checks as `unknown[]`/`unknown` when nothing is found) -- `construct
 * validate` never runs `tsc`, so an imperfect inferred type never turns into a real violation. */
function enclosingFunctionParamTypeText(ast, source, pos) {
  let best = null;
  walkAst(ast, {
    enter(node) {
      if (!FUNCTION_TYPES.has(node.type)) return;
      if (node.range[0] > pos || node.range[1] < pos) return;
      if (!best || node.range[1] - node.range[0] < best.range[1] - best.range[0]) best = node;
    },
  });
  const param = best?.params?.[0];
  const typeNode = param?.typeAnnotation?.typeAnnotation;
  return typeNode ? source.slice(typeNode.range[0], typeNode.range[1]) : null;
}

/** Best-effort element type of `propName: T[]` inside `paramTypeText` (an object type literal's
 * source text) -- e.g. finds `string` in `{ items: string[] }`. Falls back to `unknown`. */
function inferArrayElementType(paramTypeText, propName) {
  if (!paramTypeText) return 'unknown';
  const m = paramTypeText.match(new RegExp(`\\b${propName}\\??\\s*:\\s*([^;\\n}]+)\\[\\]`));
  return m ? m[1].trim() : 'unknown';
}

function findExistingLayerFile(dir, base) {
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    if (fs.existsSync(path.join(dir, base + ext))) return true;
  }
  return false;
}

/** `base`, or `base2`/`base3`/... — the first name with no existing file of that base in `dir`. */
function uniqueBaseName(dir, base) {
  if (!findExistingLayerFile(dir, base)) return base;
  for (let n = 2; ; n += 1) {
    if (!findExistingLayerFile(dir, `${base}${n}`)) return `${base}${n}`;
  }
}

/** Strip the extension and normalize to posix separators, keeping a leading `./`/`../` — mirrors
 * refactor.mjs's own bareSpecifier, except this ALSO keeps a `.ts` extension for a target under
 * typed-contracts/ (its tsconfig sets `allowImportingTsExtensions`, and its own examples/index.ts
 * import each other the same explicit way). */
function relativeSpecifier(fromDir, targetAbsPath, { keepExtension = false } = {}) {
  const relPath = path.relative(fromDir, targetAbsPath).split(path.sep).join('/');
  const withoutExt = keepExtension ? relPath : relPath.replace(/\.(tsx|ts|jsx|js)$/, '');
  return withoutExt.startsWith('.') ? withoutExt : `./${withoutExt}`;
}

/**
 * If `node` is a hand-authored native (lowercase-tag) JSXElement, hoist it into a new
 * `defineComponent(...)` unit that renders that exact tag from `{...rest}` + `{children}` — a
 * generic passthrough that preserves every attribute/child the original element had, however many
 * there were, without needing to enumerate them — and return the call-site text referencing that
 * new component instead (same attributes, same children, just a renamed/capitalized tag). Any
 * other kind of node (a JSXFragment, an existing capitalized component/expression reference, a
 * plain literal like `null`) is already EXPR-004-clean and is returned verbatim, untouched.
 *
 * @returns {{text: string, component: {name: string, source: string}|null}}
 */
function hoistIfNativeElement(node, source, componentsDir, baseName, typedContractsSpecifier) {
  if (!node || node.type !== 'JSXElement' || node.openingElement.name.type !== 'JSXIdentifier' || !/^[a-z]/.test(node.openingElement.name.name)) {
    return { text: node ? source.slice(node.range[0], node.range[1]) : 'null', component: null };
  }
  const tag = node.openingElement.name.name;
  const name = pascalCase(uniqueBaseName(componentsDir, baseName), 'Component');
  const openTagText = source.slice(node.openingElement.range[0], node.openingElement.range[1]);
  const renamedOpenTag = `<${name}${openTagText.slice(1 + tag.length)}`; // keep every attribute verbatim
  let elementText;
  if (node.openingElement.selfClosing) {
    elementText = renamedOpenTag;
  } else {
    const childrenText = source.slice(node.openingElement.range[1], node.closingElement.range[0]);
    elementText = `${renamedOpenTag}${childrenText}</${name}>`;
  }
  const componentSource = `import type { ReactNode } from 'react';\n`
    + `import { defineComponent } from '${typedContractsSpecifier}';\n\n`
    + `// Hoisted by \`construct refactor extract-expression\` (#517) out of the native <${tag}> markup\n`
    + `// an inline conditional/loop was rendering directly -- EXPR-004 forbids an Expression from\n`
    + `// hand-authoring markup itself, so the markup moves one layer down, to a real Component,\n`
    + `// and the Expression composes it by reference instead.\n`
    + `interface ${name}Props {\n  children?: ReactNode;\n  [prop: string]: unknown;\n}\n\n`
    // Deliberately `(props: ${name}Props)` + an inner destructure, not `defineComponent<${name}Props>(...)` --
    // a generic type argument between the factory name and its call parens (`defineComponent<X>(`) reads fine to
    // a human but is NOT what any factory-presence check (e.g. EXPR-006's `/\bdefineExpression\s*\(/`) matches;
    // this shape keeps every generated unit detectable by the same deterministic proxy those rules already use.
    + `export const ${name} = defineComponent('${name}', (props: ${name}Props) => {\n`
    + `  const { children, ...rest } = props;\n`
    + `  return <${tag} {...rest}>{children}</${tag}>;\n`
    + `});\n`;
  return { text: elementText, component: { name, source: componentSource } };
}

/** The JSX node a `.map`/`.flatMap` callback actually renders: the concise-arrow body itself, or
 * the argument of a `return` inside a block body — mirrors jsxComplexity.mjs's own
 * callbackProducesJsx, but returns the node instead of a boolean. */
function callbackRenderedNode(fn) {
  if (fn.body.type !== 'BlockStatement') return fn.body;
  let found = null;
  walkAst(fn.body, {
    enter(node) {
      if (!found && node.type === 'ReturnStatement' && node.argument) found = node.argument;
    },
  });
  return found;
}

function buildExpressionSource(name, propsFields, bodyText, extraImports) {
  return `import type { ReactNode } from 'react';\n`
    + `import { defineExpression } from '${TYPED_CONTRACTS_INDEX_PLACEHOLDER}';\n`
    + extraImports.map((i) => `import { ${i.name} } from '${i.specifier}';\n`).join('')
    + `\ninterface ${name}Props {\n${propsFields.map((f) => `  ${f};`).join('\n')}\n  children?: ReactNode;\n}\n\n`
    // Same reasoning as the companion Component's generated shape above (see hoistIfNativeElement):
    // `(props: ${name}Props)` + an inner destructure, never `defineExpression<${name}Props>(...)` --
    // EXPR-006's own factory-presence check is a textual `/\bdefineExpression\s*\(/`, which a generic
    // type argument between the name and the call parens would silently defeat.
    + `export const ${name} = defineExpression('${name}', (props: ${name}Props) => {\n`
    + `  const ${bodyText.paramsText} = props;\n`
    + `  return (\n${bodyText.jsx}\n  );\n`
    + `});\n`;
}
// (buildExpressionSource's typed-contracts specifier is filled in per call site, since it depends
// on the NEW file's own directory -- see the real call below; the placeholder constant name above
// only exists to keep the template readable.)
const TYPED_CONTRACTS_INDEX_PLACEHOLDER = '__TYPED_CONTRACTS_SPECIFIER__';

/**
 * Extract the inline conditional/loop JSX logic at `opts.range` (or, when omitted, the first one
 * `construct validate`'s own PAGE-008/COMPONENT-005 would report) out of `filePath` into a new
 * `defineExpression(...)` unit under that feature's `expressions/` folder — and, if that logic
 * renders hand-authored native markup, a companion `defineComponent(...)` unit under
 * `components/` — rewriting the call site to reference the new Expression. Mechanical only: never
 * changes any OTHER behavior of the file, and writes nothing when `opts.dryRun` is set.
 *
 * @param {string} root Project root.
 * @param {string} filePath The flagged page/component file (absolute, or relative to `root`).
 * @param {{range?: [number, number], name?: string, dryRun?: boolean}} [opts]
 *   `range` selects which flagged occurrence (its exact `[start, end]` source offsets, as
 *   `construct validate --format json`'s own AST positions would report) when a file has more
 *   than one; `name` overrides the derived Expression name (required when a name can't be
 *   derived, e.g. the array/condition has no nameable subject).
 * @returns {{expression: {file: string, name: string}, component: {file: string, name: string}|null, page: {file: string}, dryRun?: true}}
 * @throws {ConstructError} Usage error (exit code 2) for a missing file, a non-page/component
 *   layer, no flagged logic to extract, an unmatched `range`, or a name that can't be derived and
 *   wasn't overridden.
 */
export function extractExpression(root, filePath, opts = {}) {
  const graph = loadLayerGraph(root);
  const absFile = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  if (!fs.existsSync(absFile)) {
    throw new ConstructError(`No such file: ${rel(root, absFile)}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const relFile = rel(root, absFile);
  const layer = classifyFile(relFile, graph);
  if (layer !== 'page' && layer !== 'component') {
    throw new ConstructError(
      `construct refactor extract-expression only applies to a page or component file (${relFile} classifies as "${layer || 'unclassified'}").`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  const featureMatch = relFile.match(/^features\/([^/]+)\//);
  if (!featureMatch) {
    throw new ConstructError(`${relFile} is not inside a feature folder — cannot determine which feature owns the new expression.`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const feature = featureMatch[1];
  const featureDir = path.dirname(path.dirname(absFile)); // .../features/<feature>

  const source = fs.readFileSync(absFile, 'utf8');
  const ast = parseToAst(source);
  const hits = collectInlineJsxLogic(ast);
  if (!hits.length) {
    throw new ConstructError(`${relFile} has no inline conditional/loop JSX logic to extract (the shape PAGE-008/COMPONENT-005/EXPR-004 flag) — nothing to do.`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }

  let hit;
  if (opts.range) {
    const [start, end] = opts.range;
    hit = hits.find((h) => h.node.range[0] === start && h.node.range[1] === end);
    if (!hit) {
      const available = hits.map((h) => `${h.node.range[0]}:${h.node.range[1]} (${h.kind}, line ${lineOf(source, h.node.range[0])})`).join('; ');
      throw new ConstructError(`No flagged inline conditional/loop logic at range ${start}:${end} in ${relFile}. Flagged ranges: ${available}.`, { exitCode: EXIT_CODES.USAGE_ERROR });
    }
  } else {
    hit = hits[0]; // the same "first offender" PAGE-008/COMPONENT-005 themselves report
  }

  assertNotFrozen(absFile, 'extract an expression out of', root);

  const expressionsDir = path.join(featureDir, 'expressions');
  const componentsDir = path.join(featureDir, 'components');

  let subject; let propsFields; let paramsText; let jsxLines; let extraImports = [];
  const components = [];

  if (hit.kind === 'loop') {
    const call = hit.node; // `arrayExpr.map(callback)` / `.flatMap(callback)`
    const arrayExpr = call.callee.object;
    subject = subjectOf(arrayExpr);
    const propName = isValidPropName(subject) ? subject : 'items';
    const callback = call.arguments[call.arguments.length - 1];
    const rendered = callbackRenderedNode(callback);
    const elementType = inferArrayElementType(enclosingFunctionParamTypeText(ast, source, call.range[0]), propName);
    const hoisted = hoistIfNativeElement(rendered, source, componentsDir, `${pascalWord(singularize(propName))}Row`, relativeSpecifier(expressionsDir, TYPED_CONTRACTS_INDEX, { keepExtension: true }));
    if (hoisted.component) components.push(hoisted.component);

    const paramsSrc = callback.params.map((p) => source.slice(p.range[0], p.range[1])).join(', ');
    subject = subject || 'items';
    propsFields = [`${propName}: ${elementType}[]`];
    paramsText = `{ ${propName}, children }`;
    jsxLines = `  <>\n    {${propName}.map((${paramsSrc}) => (\n      ${hoisted.text}\n    ))}\n    {children}\n  </>`;
    if (hoisted.component) extraImports = [{ name: hoisted.component.name, specifier: relativeSpecifier(expressionsDir, path.join(componentsDir, `${hoisted.component.name}.tsx`)) }];
  } else {
    const node = hit.node; // ConditionalExpression | LogicalExpression
    const isTernary = node.type === 'ConditionalExpression';
    const test = isTernary ? node.test : node.left;
    subject = subjectOf(test);
    const propName = isValidPropName(subject) ? subject : 'condition';
    const specifierBase = relativeSpecifier(expressionsDir, TYPED_CONTRACTS_INDEX, { keepExtension: true });
    const thenNode = isTernary ? node.consequent : node.right;
    const elseNode = isTernary ? node.alternate : null;
    const thenHoisted = hoistIfNativeElement(thenNode, source, componentsDir, `${pascalWord(propName)}Content`, specifierBase);
    const elseHoisted = elseNode ? hoistIfNativeElement(elseNode, source, componentsDir, `${pascalWord(propName)}Fallback`, specifierBase) : null;
    for (const h of [thenHoisted, elseHoisted]) if (h?.component) components.push(h.component);
    extraImports = components.map((c) => ({ name: c.name, specifier: relativeSpecifier(expressionsDir, path.join(componentsDir, `${c.name}.tsx`)) }));

    propsFields = [`${propName}: boolean`];
    paramsText = `{ ${propName}, children }`;
    const branch = isTernary
      ? `${propName} ? (\n      ${thenHoisted.text}\n    ) : (\n      ${elseHoisted.text}\n    )`
      : `${propName} ${node.operator} (\n      ${thenHoisted.text}\n    )`;
    jsxLines = `  <>\n    {children}\n    {${branch}}\n  </>`;
  }

  // ---- naming (EXPR-003: never a generic placeholder) ----------------------------------------
  let name;
  if (opts.name) {
    name = pascalCase(opts.name, 'Expression name');
  } else {
    const derived = hit.kind === 'loop'
      ? `${pascalWord(singularize(subject))}List`
      : `Show${pascalWord(stripBooleanPrefix(subject || ''))}`;
    if (!subject || EXPR_GENERIC_NAMES.has(derived.toLowerCase())) {
      throw new ConstructError(
        `Could not derive an unambiguous name for the ${hit.kind} at ${lineOf(source, hit.node.range[0])} in ${relFile} — pass --name <Name>.`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    name = derived;
  }
  if (EXPR_GENERIC_NAMES.has(name.toLowerCase())) {
    throw new ConstructError(`"${name}" is a generic control-flow name (EXPR-003) — pass a specific --name.`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }

  const expressionBase = uniqueBaseName(expressionsDir, name);
  const expressionFile = path.join(expressionsDir, `${expressionBase}.tsx`);
  const typedContractsSpecifier = relativeSpecifier(expressionsDir, TYPED_CONTRACTS_INDEX, { keepExtension: true });
  const expressionSource = buildExpressionSource(expressionBase, propsFields, { paramsText, jsx: jsxLines }, extraImports)
    .replace(TYPED_CONTRACTS_INDEX_PLACEHOLDER, typedContractsSpecifier);

  // ---- the page/component call site -----------------------------------------------------------
  const propName = propsFields[0].split(':')[0].trim();
  const callSiteValueText = hit.kind === 'loop'
    ? source.slice(hit.node.callee.object.range[0], hit.node.callee.object.range[1])
    : source.slice((hit.node.type === 'ConditionalExpression' ? hit.node.test : hit.node.left).range[0], (hit.node.type === 'ConditionalExpression' ? hit.node.test : hit.node.left).range[1]);
  const callSiteText = `<${expressionBase} ${propName}={${callSiteValueText}} />`;
  const newPageSource = source.slice(0, hit.node.range[0]) + callSiteText + source.slice(hit.node.range[1]);
  const pageImportSpecifier = relativeSpecifier(path.dirname(absFile), expressionFile);
  const importLine = `import { ${expressionBase} } from '${pageImportSpecifier}';\n`;
  const finalPageSource = /^(['"]use [a-z]+['"];\n)/.test(newPageSource) ? newPageSource.replace(/^(['"]use [a-z]+['"];\n)/, `$1${importLine}`) : importLine + newPageSource;

  const result = {
    page: { file: relFile },
    expression: { file: rel(root, expressionFile), name: expressionBase },
    component: components[0] ? { file: rel(root, path.join(componentsDir, `${components[0].name}.tsx`)), name: components[0].name } : null,
    components: components.map((c) => ({ file: rel(root, path.join(componentsDir, `${c.name}.tsx`)), name: c.name })),
  };
  if (opts.dryRun) return { ...result, dryRun: true, preview: { [relFile]: finalPageSource, [rel(root, expressionFile)]: expressionSource, ...Object.fromEntries(components.map((c) => [rel(root, path.join(componentsDir, `${c.name}.tsx`)), c.source])) } };

  for (const c of components) assertNotFrozen(path.join(componentsDir, `${c.name}.tsx`), 'write to', root);
  assertNotFrozen(expressionFile, 'write to', root);
  fs.mkdirSync(componentsDir, { recursive: true });
  fs.mkdirSync(expressionsDir, { recursive: true });
  for (const c of components) fs.writeFileSync(path.join(componentsDir, `${c.name}.tsx`), c.source);
  fs.writeFileSync(expressionFile, expressionSource);
  fs.writeFileSync(absFile, finalPageSource);

  return result;
}
