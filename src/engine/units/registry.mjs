// Pluggable registry of unit-kind summarizers. A "kind" is a small object:
//   { kind, description,
//     list(ctx)                  -> [{ id, name?, path? }]
//     resolve(ctx, ref, {explicit}) -> [{ kind, id, tier }]   (tier 1 = exact, higher = looser)
//     summarize(ctx, id, detail) -> { name, path?, summary, sections, health, links, next } | null }
// Register your own with `registry.register(kind)`; the API in ../unitSummary.mjs never needs to change.
import { featureKind, layerKind, projectKind } from './kinds/feature.mjs';
import { fileKinds, exportKind, packageKind, routeKind } from './kinds/code.mjs';
import { ruleKind, envelopeKind, generatorKind } from './kinds/meta.mjs';

export function createUnitRegistry(kinds = []) {
  const map = new Map();
  const registry = {
    register(k) {
      if (!k || typeof k.kind !== 'string' || typeof k.list !== 'function' || typeof k.resolve !== 'function' || typeof k.summarize !== 'function') {
        throw new TypeError('A unit kind needs { kind, list, resolve, summarize }.');
      }
      map.set(k.kind, k);
      return registry;
    },
    get: (name) => map.get(name),
    kinds: () => [...map.values()],
    names: () => [...map.keys()],
  };
  kinds.forEach((k) => registry.register(k));
  return registry;
}

export const defaultUnitRegistry = () => createUnitRegistry([
  projectKind, featureKind, layerKind, ...fileKinds, exportKind, routeKind, packageKind, ruleKind, envelopeKind, generatorKind,
]);
