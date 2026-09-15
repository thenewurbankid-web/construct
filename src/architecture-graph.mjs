// Epic 1.1 — Layer Graph Definition
//
// Canonical layer graph (extends DEFAULT_LAYERS from config.mjs), project-level
// override support via architecture.yml's `layers:` key, and a graph-validity
// checker (no cycles, every referenced layer exists).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_LAYERS } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

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
 * Load the effective layer graph for a project: canonical defaults merged
 * with any `layers:` override in architecture.yml, validated for
 * correctness. Mirrors the way loadConfig() reads architecture.yml.
 */
export function loadLayerGraph(root) {
  const file = path.join(root, 'architecture.yml');
  /** @type {Record<string, {pattern?: string, canImport: string[]}>} */
  let layers = DEFAULT_LAYERS;
  if (fs.existsSync(file)) {
    const c = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    if (c.layers) layers = mergeLayers(DEFAULT_LAYERS, c.layers);
  }
  validateGraph(layers);
  return layers;
}

/** Is `from` allowed to import `to`? Same-layer imports are always allowed. */
export function canImport(layers, from, to) {
  if (from === to) return true;
  return !!(layers[from] && layers[from].canImport && layers[from].canImport.includes(to));
}
