// Pure (WORKFLOW-001) — which fields the Import form should show, given
// its current mode.
export function importFormVisibility(mode: string) {
  return { unit: mode === 'unit', plan: mode === 'plan' };
}
