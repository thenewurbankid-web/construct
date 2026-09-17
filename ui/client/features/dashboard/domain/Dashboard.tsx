// Pure — no fetch/window/etc. (DOMAIN-001). The seven-layer names, and the
// one shared piece of logic every layer-picker form on this page needs
// (toggling one entry in a selected-layers list) live here so CreateForm's
// and ImportForm's checkbox groups aren't independently re-deriving the
// same thing.
export const LAYERS = ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller'] as const;

export function toggleLayer(selected: string[], layer: string): string[] {
  return selected.includes(layer) ? selected.filter((l) => l !== layer) : [...selected, layer];
}
