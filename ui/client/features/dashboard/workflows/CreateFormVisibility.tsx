// Pure (WORKFLOW-001) — which fields the Create form should show, given
// its current "kind".
export function createFormVisibility(kind: string) {
  return { feature: kind !== 'feature', layer: kind === 'single', layers: kind === 'layer' };
}
