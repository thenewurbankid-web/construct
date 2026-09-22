// Epic 1.1 — Layer Graph Definition
//
// Canonical layer graph (extends DEFAULT_LAYERS from config.mjs), project-level
// override support via architecture.yml's `layers:` key, and a graph-validity
// checker (no cycles, every referenced layer exists).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_LAYERS, layersForFramework, normalizeFramework } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { globToRegExp } from './glob.mjs';
import { matchFrozen, readFrozenGlobs } from './frozen.mjs';
import { rel } from './fs.mjs';

// Names that are valid `canImport` targets but are not themselves layers with
// files to classify (e.g. a feature's types.ts). Never subject to cycle
// detection or "does this layer exist" checks.
export const PSEUDO_LAYERS = new Set(['types']);

// Re-exported for convenience so consumers of this module don't also need to
// reach into config.mjs.
export const CANONICAL_LAYERS = DEFAULT_LAYERS;

/**
 * Merge a project's `layers:` override/extension on top of the canonical
 * defaults. A layer entry may:
 *  - fully replace `canImport` by specifying it directly, or
 *  - additively extend the base layer's `canImport` via `addCanImport`.
 * New layer names not present in the base graph may also be introduced,
 * provided they declare both `pattern` and `canImport`.
 */
export function mergeLayers(base, overrides = {}) {
  /** @type {Record<string, {pattern?: string, canImport: string[]}>} */
  const merged = {};
  for (const [name, def] of Object.entries(base)) {
    merged[name] = { ...def, canImport: [...(def.canImport || [])] };
  }
  for (const [name, def] of Object.entries(overrides || {})) {
    const existing = merged[name] || { canImport: [] };
    const { addCanImport, ...defRest } = def;
    const canImport = Array.isArray(def.canImport)
      ? [...def.canImport]
      : [...new Set([...(existing.canImport || []), ...(addCanImport || [])])];
    merged[name] = { ...existing, ...defRest, canImport };
  }
  return merged;
}

/**
 * Validate a layer graph: every layer must declare a canImport array, every
 * edge must point at either a known layer or a pseudo-layer (e.g. `types`),
 * and the graph (ignoring pseudo-layers and same-layer self-edges, which are
 * always permitted) must be acyclic. Throws a ConstructError naming the
 * exact bad edge/cycle on failure.
 */
export function validateGraph(layers) {
  const names = new Set(Object.keys(layers));

  for (const [name, def] of Object.entries(layers)) {
    if (!def || !Array.isArray(def.canImport)) {
      throw new ConstructError(
        `Invalid architecture graph: layer "${name}" is missing a canImport array.`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    for (const target of def.canImport) {
      if (PSEUDO_LAYERS.has(target)) continue;
      if (!names.has(target)) {
        throw new ConstructError(
          `Invalid architecture graph: layer "${name}" declares canImport edge "${name} -> ${target}", but layer "${target}" does not exist.`,
          { exitCode: EXIT_CODES.USAGE_ERROR },
        );
      }
    }
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...names].map((n) => [n, WHITE]));

  function visit(node, stack) {
    color.set(node, GRAY);
    for (const target of layers[node].canImport) {
      if (PSEUDO_LAYERS.has(target) || target === node) continue;
      if (color.get(target) === GRAY) {
        throw new ConstructError(
          `Invalid architecture graph: cycle detected (${[...stack, node, target].join(' -> ')}).`,
          { exitCode: EXIT_CODES.USAGE_ERROR },
        );
      }
      if (color.get(target) === WHITE) visit(target, [...stack, node]);
    }
    color.set(node, BLACK);
  }

  for (const name of names) {
    if (color.get(name) === WHITE) visit(name, []);
  }

  return true;
}

/**
 * Load the effective layer graph for a project: the base graph for its
 * `project.framework` (nextjs by default — see config.mjs's
 * layersForFramework) merged with any `layers:` override in
 * architecture.yml, validated for correctness. Mirrors the way loadConfig()
 * reads architecture.yml.
 *
 * @param {string} root Project root; `architecture.yml` is optional.
 * @returns {Record<string, {pattern?: string, canImport: string[]}>} The validated layer graph: layer name to file pattern and the layers it may import.
 * @throws {Error} When the merged graph is invalid (unknown layer in `canImport`, and so on).
 * @since 0.8
 */
export function loadLayerGraph(root) {
  const file = path.join(root, 'architecture.yml');
  /** @type {Record<string, {pattern?: string, canImport: string[]}>} */
  let layers = DEFAULT_LAYERS;
  if (fs.existsSync(file)) {
    const c = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    const base = layersForFramework(normalizeFramework(c.project?.framework));
    layers = c.layers ? mergeLayers(base, c.layers) : base;
  }
  validateGraph(layers);
  return layers;
}

/** Is `from` allowed to import `to`? Same-layer imports are always allowed. */
export function canImport(layers, from, to) {
  if (from === to) return true;
  return !!(layers[from] && layers[from].canImport && layers[from].canImport.includes(to));
}

/**
 * THE layer classifier (#174): the first layer in `graph` whose `pattern` glob matches the
 * project-relative path, or null. Driven entirely by the (framework + `layers:` override) graph,
 * so a custom pattern classifies files the same way everywhere -- the enforcers, `parseFile`
 * summaries, the readability checks.
 *
 * @param {string} relPath Project-relative path, forward slashes.
 * @param {Record<string, {pattern?: string}>} graph Layer graph from `loadLayerGraph`.
 * @returns {string|null} The first layer whose pattern matches, or `null` when the file belongs to no layer.
 *
 * @example
 * classifyFile('features/plan/services/planApi.ts', loadLayerGraph(root)); // => 'service'
 */
export function classifyFile(relPath, graph) {
  for (const [layer, def] of Object.entries(graph)) {
    if (def.pattern && globToRegExp(def.pattern).test(relPath)) return layer;
  }
  return null;
}

/**
 * Classify a file of the project at `root` the way the enforcers see it: through the project's
 * layer graph, and a file inside a configured `frozen:` region is externally authored, so it is
 * never classified (null). Pass `{ graph, frozenGlobs }` when classifying many files so the
 * graph/config are loaded once; otherwise they are loaded from `root`.
 *
 * @param {string} root Project root.
 * @param {string} filePath Absolute or project-relative file path.
 * @param {object} [options]
 * @param {object} [options.graph] Pre-loaded layer graph (avoids re-reading config per file).
 * @param {string[]} [options.frozenGlobs] Pre-loaded frozen globs.
 * @returns {string|null} The layer name, or `null` for unclassified and frozen files.
 */
export function classifyProjectFile(root, filePath, { graph, frozenGlobs } = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const g = graph || loadLayerGraph(root);
  const frozen = frozenGlobs || readFrozenGlobs(root);
  if (frozen.length && matchFrozen(root, abs, frozen)) return null;
  return classifyFile(rel(root, abs), g);
}
