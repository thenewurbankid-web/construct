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
import { parseToAst } from '../ast/index.mjs';
import { resolveImportSpecifier } from '../core/route-resolver.mjs';

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
 * lists Provider hooks the enforcer itself would vouch for. */
function isRealProviderExport(ctx, relPath, name) {
  if (!isProviderHookName(name)) return false;
  const f = ctx.facts(relPath);
  if (!f.exports.some((e) => e.name === name)) return false;
  const source = readSource(ctx.root, relPath);
  return !!source && /\bdefineProvider\s*\(/.test(source);
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
