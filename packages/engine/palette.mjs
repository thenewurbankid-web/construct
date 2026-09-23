// Pages editor block palette read model (#527, Slice 1 of #518's design, docs/design/block-palette.md).
// For one feature: every Provider hook, Expression and Component its pages could actually import,
// computed from the real `canImport` graph (packages/core/config.mjs, via the same layer
// classification `packages/engine/units/facts.mjs` already uses for every other unit summary) plus
// the naming convention + real factory call that HOOK-002/PAGE-006 hold Provider hooks to
// (packages/core/architecture-enforcer.mjs) -- never a hand-maintained or invented list.
//
// Pure, deterministic, no LLM: same tree in -> same JSON out. Two sources, one feature at a time:
//   - the feature's OWN hooks/expressions/components (path convention alone decides the layer);
//   - every OTHER feature's re-export through its public `index.ts` (the one-hop `export { X } from
//     '...'` / `export * from '...'` shape SLICE-002 already treats as a feature's real interface),
//     resolved with the same specifier resolver `facts.mjs` uses for a file's own imports.
import fs from 'node:fs';
import path from 'node:path';
import { createContext, isTestFile } from './units/facts.mjs';
import { featureNames } from './units/kinds/feature.mjs';
import { parseToAst, parseTsSource, ts, collectInlineJsxLogic, lineOf } from '../ast/index.mjs';
import { resolveImportSpecifier } from '../core/route-resolver.mjs';
import { hasFactoryCall } from '../core/architecture-enforcer.mjs';
import { subjectOf } from '../core/extractExpression.mjs';

// Mirrors architecture-enforcer.mjs's PROVIDER_HOOK_NAME_RE exactly (#510) -- the naming convention
// PAGE-006 relies on to let a page import a Provider hook directly.
const PROVIDER_HOOK_NAME_RE = /^use[A-Z]\w*Provider$/;
const isProviderHookName = (name) => typeof name === 'string' && PROVIDER_HOOK_NAME_RE.test(name);

const featureRootPattern = (ctx) => new RegExp(`^${ctx.featuresRoot()}/([^/]+)/`);
const featureOfPath = (ctx, p) => p.match(featureRootPattern(ctx))?.[1] ?? null;

function readSource(root, relPath) {
  try {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
  } catch {
    return null;
  }
}

/** HOOK-002's real test: named like a Provider AND actually built through `defineProvider(...)`, not
 * just named like one -- the same check the enforcer applies, applied here so the palette only ever
 * lists Provider hooks the enforcer itself would vouch for. Uses architecture-enforcer.mjs's shared
 * `hasFactoryCall` (#531) so a `defineProvider<Props>(...)` generic-argument call is recognized here
 * exactly as HOOK-002 recognizes it, instead of this file's own plain-`(`-only regex missing it. */
function isRealProviderExport(ctx, relPath, name) {
  if (!isProviderHookName(name)) return false;
  const f = ctx.facts(relPath);
  if (!f.exports.some((e) => e.name === name)) return false;
  const source = readSource(ctx.root, relPath);
  return !!source && hasFactoryCall('defineProvider', source);
}

/** The export whose name best identifies "the unit this file is" -- the one matching the file's own
 * base name (this codebase's one-file-one-unit convention), falling back to the first export. */
function primaryExportName(ctx, relPath) {
  const base = path.basename(relPath).replace(/\.(tsx|ts|jsx|js|mjs)$/, '');
  const names = ctx.facts(relPath).exports.map((e) => e.name).filter(Boolean);
  return names.find((n) => n === base) || names.find((n) => n.toLowerCase() === base.toLowerCase()) || names[0] || base;
}

/** One feature's public `index.ts`, re-export by re-export: `{ targetRel, names }[]`, where `names`
 * is the list of local names that one `export { ... } from '...'` line re-exports, or `null` for a
 * wildcard (`export * from '...'`) -- every export of the target file is reachable in that case.
 * Processed node-by-node (not `facts.mjs`'s flattened `exports`/`resolvedImports` arrays) so a
 * multi-line index.ts never lets one line's names bleed into another's target file. */
function publicReexports(ctx, feature) {
  const indexRel = `${ctx.featuresRoot()}/${feature}/index.ts`;
  const abs = path.join(ctx.root, indexRel);
  if (!fs.existsSync(abs)) return [];
  const source = readSource(ctx.root, indexRel);
  if (source == null) return [];
  let ast;
  try {
    ast = parseToAst(source);
  } catch {
    return [];
  }
  const out = [];
  for (const node of ast.body) {
    const isReexport = (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source;
    if (!isReexport) continue;
    const target = resolveImportSpecifier(abs, node.source.value, ctx.aliases());
    if (!target) continue;
    const targetRel = path.relative(ctx.root, target).split(path.sep).join('/');
    const names = node.type === 'ExportAllDeclaration' ? null : (node.specifiers || []).map((s) => s.exported?.name ?? s.exported?.value).filter(Boolean);
    out.push({ targetRel, names });
  }
  return out;
}

function makeEntry(ctx, relPath, name, ownerFeature, via) {
  const f = ctx.facts(relPath);
  return { name, path: relPath, feature: ownerFeature, via, description: f.purpose || '' };
}

/**
 * The three groups a feature's pages can actually reach: Providers (hook layer, Provider-named +
 * `defineProvider`-built only), Expressions (expression layer) and Components (component layer) --
 * this feature's own, plus any other feature's re-exported through its public index.
 *
 * @param {string} root Project root.
 * @param {string} feature Feature name (as under `features/`, or the configured features root).
 * @returns {{ok:true, feature:string, providers:object[], expressions:object[], components:object[]} | {ok:false, error:string}}
 */
export function buildPalette(root, feature) {
  if (typeof feature !== 'string' || !feature || /[/\\]/.test(feature)) {
    return { ok: false, error: 'Invalid feature name.' };
  }
  const ctx = createContext(path.resolve(root));
  if (!featureNames(ctx).includes(feature)) {
    return { ok: false, error: `No such feature: ${feature}` };
  }

  const providers = [];
  const expressions = [];
  const components = [];
  const seen = new Set();
  const add = (list, layer, relPath, name, ownerFeature, via) => {
    const key = `${layer}:${relPath}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(makeEntry(ctx, relPath, name, ownerFeature, via));
  };

  // This feature's own hooks/expressions/components -- path convention alone decides the layer.
  for (const p of ctx.sourceFiles()) {
    if (isTestFile(p) || featureOfPath(ctx, p) !== feature) continue;
    const layer = ctx.layerOf(p);
    if (layer === 'hook') {
      for (const e of ctx.facts(p).exports) {
        if (isRealProviderExport(ctx, p, e.name)) add(providers, 'hook', p, e.name, feature, null);
      }
    } else if (layer === 'expression') {
      add(expressions, 'expression', p, primaryExportName(ctx, p), feature, null);
    } else if (layer === 'component') {
      add(components, 'component', p, primaryExportName(ctx, p), feature, null);
    }
  }

  // Every other feature's own Provider/Expression/Component, reachable only through what that
  // feature's public index.ts actually re-exports (SLICE-002's public-API surface).
  for (const other of featureNames(ctx)) {
    if (other === feature) continue;
    for (const { targetRel, names } of publicReexports(ctx, other)) {
      if (isTestFile(targetRel) || featureOfPath(ctx, targetRel) !== other) continue;
      const layer = ctx.layerOf(targetRel);
      const via = `${other}'s public index`;
      if (layer === 'hook') {
        for (const e of ctx.facts(targetRel).exports) {
          if (!isRealProviderExport(ctx, targetRel, e.name)) continue;
          if (names && !names.includes(e.name)) continue;
          add(providers, 'hook', targetRel, e.name, other, via);
        }
      } else if (layer === 'expression') {
        const name = primaryExportName(ctx, targetRel);
        if (names && !names.includes(name)) continue;
        add(expressions, 'expression', targetRel, name, other, via);
      } else if (layer === 'component') {
        const name = primaryExportName(ctx, targetRel);
        if (names && !names.includes(name)) continue;
        add(components, 'component', targetRel, name, other, via);
      }
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    ok: true,
    feature,
    providers: providers.sort(byName),
    expressions: expressions.sort(byName),
    components: components.sort(byName),
  };
}

// ---- "Wrap with..." (#533, Slice 3 of #518's design) --------------------------------------------
// Additive to everything above: Slice 1 (buildPalette) and Slice 2 (buildPaletteInsertion,
// ui/server/src/pagesEditor.mjs) are unchanged by anything below. This section answers two
// questions the Palette tab's Wrap flow needs once a JSX selection lands on a PAGE-008-flagged
// range: "what flagged conditional/loop encloses the current selection" (findWrapHit +
// describeWrapHit) and "does each existing Expression in scope structurally fit it, or would it
// need dimming with a reason" (expressionShape + wrapFit) -- never a hand-maintained list, the same
// discipline buildPalette itself already holds to.

/**
 * The flagged PAGE-008 conditional/loop (packages/ast/jsxComplexity.mjs's own
 * `collectInlineJsxLogic`) that encloses `range` (a `[start, end]` source-offset pair, e.g. a
 * selected JSX element's own range from the same parse) -- the smallest one that contains it, since
 * a loop can nest a conditional or vice versa. `range` omitted returns the first flagged hit overall
 * (mirrors extractExpression.mjs's own "no --range" default).
 *
 * @param {string} source A page/component file's current full source.
 * @param {[number, number]} [range] The selection's own `[start, end]` source offsets.
 * @returns {{kind:'loop'|'conditional', node:object}|null} The smallest enclosing flagged hit, or
 *   `null` when nothing flagged encloses the selection (including when the file has no flagged
 *   logic at all) -- callers treat that as "nothing to suggest wrapping here", not an error.
 */
export function findWrapHit(source, range) {
  let ast;
  try {
    ast = parseToAst(source);
  } catch {
    return null;
  }
  const hits = collectInlineJsxLogic(ast);
  if (!hits.length) return null;
  if (!range) return hits[0];
  const [start, end] = range;
  const enclosing = hits.filter((h) => h.node.range[0] <= start && h.node.range[1] >= end);
  if (!enclosing.length) return null;
  // Smallest enclosing range wins (the innermost flagged shape, not an outer one that happens to
  // also contain it).
  enclosing.sort((a, b) => (a.node.range[1] - a.node.range[0]) - (b.node.range[1] - b.node.range[0]));
  return enclosing[0];
}

/** The subject a flagged hit is "about", for display -- the mapped array for a loop, the tested
 * condition for a conditional (extractExpression.mjs's own `subjectOf`, reused so the callout names
 * the exact same identifier the codemod itself would derive a name from). */
function hitSubject(hit) {
  if (hit.kind === 'loop') return subjectOf(hit.node.callee.object);
  const isTernary = hit.node.type === 'ConditionalExpression';
  return subjectOf(isTernary ? hit.node.test : hit.node.left);
}

/**
 * Human-readable description of one flagged hit, for the Palette tab's selection callout (design's
 * "3 elements from a `.map()` over `cartItems`... flagged PAGE-008" -- the real subject and line,
 * never illustrative copy). Only ever called on a page file (the Palette tab is Pages-editor-only),
 * so the flagged rule is always PAGE-008 (COMPONENT-005 is the same shape's component-layer name).
 *
 * @param {string} source The page file's current full source (the same string `hit` was found in).
 * @param {{kind:'loop'|'conditional', node:object}} hit A hit from `findWrapHit`.
 * @returns {{kind:string, range:[number,number], line:number, subject:string|null, summary:string, rule:string}}
 */
export function describeWrapHit(source, hit) {
  const subject = hitSubject(hit);
  const line = lineOf(source, hit.node.range[0]);
  const summary = hit.kind === 'loop'
    ? `Elements rendered by a \`.map()\`${subject ? ` over \`${subject}\`` : ''} (line ${line}) — flagged PAGE-008.`
    : `A conditional branch${subject ? ` on \`${subject}\`` : ''} (line ${line}) — flagged PAGE-008.`;
  return { kind: hit.kind, range: [hit.node.range[0], hit.node.range[1]], line, subject, summary, rule: 'PAGE-008' };
}

/**
 * Best-effort structural shape of an Expression's own Props interface -- `'loop'` (an array-typed
 * field besides `children`), `'conditional'` (a `boolean`-typed field), or `'unknown'` (neither
 * found, e.g. a hand-written Expression whose prop is some other type). Mirrors
 * extractExpression.mjs's own two generated Props shapes exactly (`propName: T[]` / `propName:
 * boolean`), so any Expression the codemod itself created is always classified correctly; anything
 * else is a best-effort proxy for sorting/dimming suggestions, never a hard architecture rule (no
 * EXPR-* check depends on this).
 *
 * @param {string} root Project root.
 * @param {string} relPath The Expression file's project-root-relative path.
 * @param {string} name The Expression's own exported name (its Props interface is `${name}Props`).
 * @returns {'loop'|'conditional'|'unknown'}
 */
export function expressionShape(root, relPath, name) {
  const source = readSource(root, relPath);
  if (!source) return 'unknown';
  let sourceFile;
  try {
    sourceFile = parseTsSource(source, path.basename(relPath));
  } catch {
    return 'unknown';
  }
  const typeName = `${name}Props`;
  /** @type {'loop'|'conditional'|'unknown'} */
  let shape = 'unknown';
  const visit = (node) => {
    if (shape !== 'unknown') return;
    if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
      for (const m of node.members) {
        if (shape !== 'unknown') break;
        if (!ts.isPropertySignature(m) || !m.name || !ts.isIdentifier(m.name) || m.name.text === 'children' || !m.type) continue;
        if (ts.isArrayTypeNode(m.type)) shape = 'loop';
        else if (m.type.kind === ts.SyntaxKind.BooleanKeyword) shape = 'conditional';
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return shape;
}

/**
 * Does an existing Expression of shape `shape` structurally fit a flagged hit of kind `hitKind` --
 * `'fits'` (same shape), `'unknown'` (can't tell, never dimmed: "never show something the
 * architecture wouldn't allow" cuts both ways -- an unproven guess doesn't get labelled wrong
 * either), or `'not-a-fit'` (concretely the other shape) with a plain-language reason, per
 * block-palette.md section 3 step 2's "stays visible but dimmed with an explicit reason" rule.
 *
 * @param {'loop'|'conditional'} hitKind The flagged hit's own kind (`findWrapHit`'s `kind`).
 * @param {'loop'|'conditional'|'unknown'} shape An Expression's own shape (`expressionShape`).
 * @returns {{fit:'fits'|'unknown'|'not-a-fit', reason:string|null}}
 */
export function wrapFit(hitKind, shape) {
  if (shape === 'unknown') return { fit: 'unknown', reason: null };
  if ((hitKind === 'loop' && shape === 'loop') || (hitKind === 'conditional' && shape === 'conditional')) {
    return { fit: 'fits', reason: null };
  }
  return {
    fit: 'not-a-fit',
    reason: shape === 'loop'
      ? 'Expects a list to loop over — this selection is a single condition, not a loop.'
      : 'Expects a single boolean condition — this selection is a loop, not a condition.',
  };
}

/**
 * The Wrap-with suggestion for one JSX selection on a page: the flagged hit it falls inside (or
 * `null`, meaning nothing here is PAGE-008-flagged — the Palette tab shows no Wrap affordance), and
 * every Expression in `palette.expressions` (Slice 1's own `buildPalette` output — same reachability
 * rule, nothing new invented) annotated with its fit against that hit.
 *
 * @param {string} root Project root.
 * @param {string} source The page file's current full source (same string the selection's own
 *   `[start, end]` range was computed from).
 * @param {[number, number]} range The selected JSX node's own `[start, end]` source offsets.
 * @param {{expressions: object[]}} palette A fresh `buildPalette(...)` result for this feature.
 * @returns {{hit: object|null, suggestions: object[]}}
 */
export function buildWrapSuggestions(root, source, range, palette) {
  const hit = findWrapHit(source, range);
  if (!hit) return { hit: null, suggestions: [] };
  const hitInfo = describeWrapHit(source, hit);
  const order = { fits: 0, unknown: 1, 'not-a-fit': 2 };
  const suggestions = palette.expressions
    .map((entry) => ({ ...entry, ...wrapFit(hit.kind, expressionShape(root, entry.path, entry.name)) }))
    .sort((a, b) => order[a.fit] - order[b.fit] || a.name.localeCompare(b.name));
  return { hit: hitInfo, suggestions };
}
