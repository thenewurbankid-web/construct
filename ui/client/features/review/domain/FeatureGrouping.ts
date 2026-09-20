// Pure (DOMAIN-001): the product of the Review screen. A change is a list of files; Construct knows which
// feature and layer each belongs to (the engine resolved that from the layer graph, not from path
// guessing), so the Browser shows CHANGED UNITS GROUPED BY FEATURE THEN LAYER instead of a flat file list.
// A file the engine could not place in a feature or layer still appears, in a labelled group of its own.
import type { ChangedFile, FeatureGroup, LayerGroup, TreeFile } from '../types.ts';
import { layerLabel, layerRank, UNCLASSIFIED_LAYER } from './LayerOrder.ts';
import { toTreeFile } from './TreeFiles.ts';

export const OUTSIDE_LABEL = 'Outside features';

const byPath = (a: TreeFile, b: TreeFile) => a.path.localeCompare(b.path);

/** Files split by layer, layers in reading order. */
export function toLayers(files: ChangedFile[]): LayerGroup[] {
  const map = new Map<string, TreeFile[]>();
  for (const f of files) {
    const layer = f.layer ?? UNCLASSIFIED_LAYER;
    map.set(layer, [...(map.get(layer) ?? []), toTreeFile(f)]);
  }
  return [...map.entries()]
    .map(([layer, list]) => ({ layer, label: layerLabel(layer), files: [...list].sort(byPath) }))
    .sort((a, b) => layerRank(a.layer) - layerRank(b.layer) || a.layer.localeCompare(b.layer));
}

/** Features first (alphabetical), then everything that lives outside any feature; each split by layer. */
export function groupByFeature(files: ChangedFile[]): FeatureGroup[] {
  const inFeature = new Map<string, ChangedFile[]>();
  const outside: ChangedFile[] = [];
  for (const f of files) {
    if (f.feature) inFeature.set(f.feature, [...(inFeature.get(f.feature) ?? []), f]);
    else outside.push(f);
  }
  const groups: FeatureGroup[] = [...inFeature.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ key: `feature:${name}`, name, label: name, fileCount: list.length, layers: toLayers(list), outside: false }));
  if (outside.length) groups.push({ key: 'outside', name: '', label: OUTSIDE_LABEL, fileCount: outside.length, layers: toLayers(outside), outside: true });
  return groups;
}
