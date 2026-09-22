// #513 (extends #437, part of #500's typed-contracts epic) -- exports a project's resolved
// architecture.yml layer graph (packages/core/config.mjs's DEFAULT_LAYERS/canImport model, as
// merged by architecture-graph.mjs's loadLayerGraph) to a real eslint-plugin-boundaries config.
//
// STRICTLY ADDITIVE, a complement not a replacement: `construct validate`'s own AST-based
// architecture-enforcer.mjs/soc-enforcer.mjs stay authoritative. This gives a project a CI-time
// / editor-time ESLint check that mirrors the same canImport graph, so a boundary violation shows
// up instantly in an editor or a lint pass, before a full `construct validate` run -- eslint-plugin-
// boundaries and dependency-cruiser are the target project's own tools; Construct only generates
// their config (no runtime dependency on either is added to Construct itself).
//
// Scope (deliberately narrow, matching #513's own brief): only the import-boundary graph
// (`layers[x].canImport`) becomes boundaries dependency rules. Not attempted here --
// each is either not expressible as a path/import-boundary rule, or is a distinct concern:
//   - SLICE-001/002/003/004 (feature-internal isolation, public-API-only cross-feature imports,
//     index.ts sync, wrapper-not-reexport) -- these need module-resolution/AST checks
//     (what a file actually re-exports), not a from/to layer-pattern rule.
//   - DOMAIN-001/002, PURE-001, WORKFLOW-001/002/003, CONTROLLER-001/002, SERVICE-001/002,
//     ROUTE-002, PAGE-001/004/006/007/008/009, COMPONENT-001/004/005/006, EXPR-001..006,
//     HOOK-001/002, MODULE-001, DRY-001, SOC-001, READ-*, IMPORT-001, PROP-LINK -- semantic/
//     shape/naming/purity checks with no path-glob form (the same "not expressible" boundary
//     #437 documents for dependency-cruiser).
// A project that wants those still runs `construct validate`; this export only ever narrows the
// feedback loop for the subset that Construct's own canImport graph already fully describes.
//
// `frozen:`/`nonLayer:` handling: no special-casing needed. A file that matches none of the
// generated `boundaries/elements` patterns is simply unclassified to eslint-plugin-boundaries,
// so `boundaries/dependencies` (which only fires between two classified elements) never touches
// it -- the same "unrecognized region is silently out of scope" behavior Construct's own
// enforcers give frozen/nonLayer paths, with no extra glob wiring required here.
import { loadLayerGraph } from './architecture-graph.mjs';

/** Pattern for the `types` pseudo-layer (architecture-graph.mjs's PSEUDO_LAYERS): a valid
 * canImport target with no entry in the layer graph itself (it's not a folder of files to
 * classify by the enforcers), but a real, always-present per-feature file
 * (features/*\/types.ts, see generators.mjs's createFeature). Recognizing it as a real
 * `boundaries/elements` entry lets `boundaries/dependencies` validate `x -> types` edges too,
 * instead of leaving every such edge unclassified (and therefore silently unchecked).
 */
export const TYPES_ELEMENT_PATTERN = 'features/*/types.ts';

/** True when `pattern`'s last path segment names a specific file (has a dot-extension, e.g.
 * `page.tsx`/`App.tsx`/`types.ts`) rather than a folder of many files (e.g. `components/**`).
 * eslint-plugin-boundaries' element descriptors default to folder/`partialMatch` semantics
 * (a pattern is matched against every ancestor folder of a file, not just the full path); a
 * file-shaped pattern needs `partialMatch: false` instead, or the plugin logs a real, correct
 * runtime warning ("Element patterns match folders, not individual files") that a project
 * adopting this generated config would otherwise see on its very first run. Verified empirically
 * against the installed eslint-plugin-boundaries@7.2.0 (see test/exportArchitectureRules.test.mjs). */
function isFileLikePattern(pattern) {
  const lastSegment = pattern.split('/').pop() || '';
  return /\.[^./]+$/.test(lastSegment);
}

/**
 * Build the `boundaries/elements` settings array from a layer graph: one `{type, pattern}`
 * entry per real layer (skipping any graph entry without its own `pattern`, e.g. a project-
 * defined pseudo-layer), plus the `types` pseudo-layer's own real file pattern. A pattern that
 * names one specific file (e.g. `src/App.tsx`, `features/*\/types.ts`) also gets
 * `partialMatch: false` (see `isFileLikePattern`). Sorted by type name for a deterministic,
 * diff-friendly output.
 *
 * @param {Record<string, {pattern?: string, canImport?: string[]}>} graph A layer graph, e.g. from `loadLayerGraph(root)`.
 * @returns {{type: string, pattern: string, partialMatch?: false}[]}
 *
 * @example
 * boundariesElements({ domain: { pattern: 'features/*\/domain/**', canImport: ['types'] } });
 * // => [{ type: 'domain', pattern: 'features/*\/domain/**' }, { type: 'types', pattern: 'features/*\/types.ts', partialMatch: false }]
 */
export function boundariesElements(graph) {
  const toElement = (type, pattern) => ({
    type,
    pattern,
    ...(isFileLikePattern(pattern) ? { partialMatch: false } : {}),
  });
  const elements = Object.entries(graph)
    .filter(([, def]) => def && typeof def.pattern === 'string' && def.pattern)
    .map(([type, def]) => toElement(type, def.pattern));
  if (!elements.some((e) => e.type === 'types')) {
    elements.push(toElement('types', TYPES_ELEMENT_PATTERN));
  }
  return elements.sort((a, b) => a.type.localeCompare(b.type));
}

// #513's own brief names `boundaries/element-types` with a plain `{from, allow}` `rules` array
// as the target shape -- that exact form was verified empirically (test/exportArchitectureRules.
// test.mjs) to still work against the installed eslint-plugin-boundaries@7.2.0, but the plugin
// itself flags it at runtime as legacy on every single lint run: `element-types` is a deprecated
// alias for `dependencies` (renamed in v6), plain string selectors and a bare `rules` array are
// each individually deprecated in favor of `policies` with object-based `{ element: { type }}`
// selectors (v7), and the plugin prints one `console.warn` per deprecated shape it detects --
// four distinct warnings for this project's own graph, on every lint invocation, before a single
// real file is even checked. That is exactly the kind of first-run friction the "dev ex is user
// ex" standing instruction (CLAUDE.md) says to weigh as a real UX problem, not routine noise --
// so this generator emits the actively-maintained, warning-free equivalent instead:
// `boundaries/dependencies` + `policies`, with `{ element: { type } }`/`{ element: { types: {
// anyOf } } }` selectors. The semantics are identical to a canImport edge (`from -> allow`); only
// the surface syntax differs, and this shape is what a developer reading the generated file
// today (or eslint-plugin-boundaries' own current docs) will actually recognize as current.

/**
 * Build the `boundaries/dependencies` rule's `policies` array directly from a layer graph's
 * `canImport` edges -- one policy per layer that declares at least one allowed target, using
 * eslint-plugin-boundaries v7's object-based element selectors (`{ element: { type } }` /
 * `{ element: { types: { anyOf } } }`), the actively-maintained, warning-free equivalent of a
 * legacy `{from, allow}` pair (see the module-level comment above for why). Sorted by the
 * source type, with each `anyOf` list sorted, for deterministic output.
 *
 * @param {Record<string, {canImport?: string[]}>} graph A layer graph, e.g. from `loadLayerGraph(root)`.
 * @returns {{from: {element: {type: string}}, allow: {to: {element: {types: {anyOf: string[]}}}}}[]}
 */
export function boundariesDependencyPolicies(graph) {
  return Object.entries(graph)
    .filter(([, def]) => def && Array.isArray(def.canImport) && def.canImport.length > 0)
    .map(([from, def]) => ({
      from: { element: { type: from } },
      allow: { to: { element: { types: { anyOf: [...new Set(def.canImport)].sort() } } } },
    }))
    .sort((a, b) => a.from.element.type.localeCompare(b.from.element.type));
}

/**
 * The format-agnostic core of the export: the `settings`/`rules` object that both a flat-config
 * module and a legacy `.eslintrc`-shaped config embed identically (eslint-plugin-boundaries'
 * `boundaries/elements` setting and `boundaries/dependencies` rule have the same shape in either
 * format -- only the surrounding file structure differs).
 *
 * @param {Record<string, {pattern?: string, canImport?: string[]}>} graph A layer graph, e.g. from `loadLayerGraph(root)`.
 * @returns {{settings: {'boundaries/elements': {type:string,pattern:string}[]}, rules: {'boundaries/dependencies': [string, {default: string, policies: object[]}]}}}
 */
export function exportBoundariesConfigFromGraph(graph) {
  return {
    settings: {
      'boundaries/elements': boundariesElements(graph),
      // Load-bearing, not cosmetic (verified empirically -- test/exportArchitectureRules.test.mjs):
      // eslint-plugin-boundaries resolves each import specifier via eslint-module-utils (already
      // one of its own dependencies, so this adds nothing new), which in turn defaults to
      // eslint-import-resolver-node's own default extension list -- .js/.mjs/.json/.node, NOT
      // .ts/.tsx. Every Construct-generated project is TypeScript (package.json's own
      // `typescript` dependency, architecture.yml's `project.language`), so without this, EVERY
      // relative import into a `.ts`/`.tsx` file fails to resolve, the target is classified
      // "unknown" instead of its real layer, and `boundaries/dependencies` silently reports zero
      // violations no matter how the layers are wired -- a green CI check that is actually
      // checking nothing. Confirmed by reproducing exactly that silent-pass failure mode against
      // a real deliberately-bad cross-layer import before adding this setting.
      'import/resolver': { node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] } },
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies: boundariesDependencyPolicies(graph) }],
    },
  };
}

/**
 * Load `root`'s effective layer graph (architecture.yml, including any `layers:` override) and
 * export it to the same `{settings, rules}` shape as `exportBoundariesConfigFromGraph`.
 *
 * @param {string} root Project root that contains (or should contain) `architecture.yml`.
 * @returns {ReturnType<typeof exportBoundariesConfigFromGraph>}
 * @since 0.10
 *
 * @example
 * const { settings, rules } = exportBoundariesConfig(process.cwd());
 * const pagePolicy = rules['boundaries/dependencies'][1].policies.find((p) => p.from.element.type === 'page');
 * pagePolicy.allow.to.element.types.anyOf; // => ['component', 'types']
 */
export function exportBoundariesConfig(root) {
  return exportBoundariesConfigFromGraph(loadLayerGraph(root));
}

const GENERATED_HEADER = `// Generated by Construct (packages/core/exportArchitectureRules.mjs) from architecture.yml's
// layer graph. Do NOT edit by hand -- re-run the generator after changing architecture.yml's
// \`layers\`/canImport graph, or this file will drift from what \`construct validate\` enforces.
//
// This is a complement to \`construct validate\`, not a replacement for it: Construct's own
// AST-based rule engine (architecture-enforcer.mjs) stays authoritative and covers rules this
// path-based check cannot (purity, naming, complexity, cross-file public-API checks, ...). What
// this DOES give you: the same import-boundary graph enforced live, in your editor and in CI, via
// ESLint's own tooling (eslint-plugin-boundaries, MIT).
`;

/**
 * Render `root`'s exported boundaries config as a standalone ESLint flat-config module
 * (the format ESLint 9+/10 requires -- see https://eslint.org/docs/latest/use/configure/configuration-files).
 * A consuming project imports this file's default export and spreads it into its own
 * `eslint.config.mjs` (or points ESLint straight at it for a boundaries-only check).
 *
 * @param {string} root Project root that contains (or should contain) `architecture.yml`.
 * @returns {string} A complete, ready-to-write ESM module's source text.
 * @since 0.10
 */
export function generateEslintFlatConfigModule(root) {
  const { settings, rules } = exportBoundariesConfig(root);
  const indent = (json) => json.split('\n').join('\n    ');
  return `${GENERATED_HEADER}
import boundaries from 'eslint-plugin-boundaries';

export default [
  {
    plugins: { boundaries },
    settings: ${indent(JSON.stringify(settings, null, 2))},
    rules: ${indent(JSON.stringify(rules, null, 2))},
  },
];
`;
}
