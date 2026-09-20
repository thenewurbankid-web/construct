// Pure (DOMAIN-001): the order layers read in, from the core of a feature outward to where it is wired up.
// A layer the engine could not name reads "not classified" instead of being hidden.
export const UNCLASSIFIED_LAYER = 'unclassified';

const LAYER_ORDER = ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller', 'route'];

export function layerRank(layer: string): number {
  const i = LAYER_ORDER.indexOf(layer);
  if (i >= 0) return i;
  return layer === UNCLASSIFIED_LAYER ? 1000 : 100;
}

export const layerLabel = (layer: string): string => (layer === UNCLASSIFIED_LAYER ? 'not classified' : layer);
