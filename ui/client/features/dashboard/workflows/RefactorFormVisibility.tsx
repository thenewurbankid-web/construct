// Pure (WORKFLOW-001) — which fields the Refactor form should show, given
// its current action.
export function refactorFormVisibility(action: string) {
  return { move: action === 'move', rename: action === 'rename' };
}
