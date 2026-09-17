// Pure (WORKFLOW-001) — which fields the Research form should show, given
// its current action.
export function researchFormVisibility(action: string) {
  return { summarize: action === 'summarize' };
}
