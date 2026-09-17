// Pure flow decisions (no React import — WORKFLOW-001): which fields each
// of the four command forms should show, given their current mode/action.
// Kept here instead of inlined in the presentational forms so the
// branching logic driving what's on screen has one testable home.
export function createFormVisibility(kind: string) {
  return { feature: kind !== 'feature', layer: kind === 'single', layers: kind === 'layer' };
}

export function refactorFormVisibility(action: string) {
  return { move: action === 'move', rename: action === 'rename' };
}

export function researchFormVisibility(action: string) {
  return { summarize: action === 'summarize' };
}

export function importFormVisibility(mode: string) {
  return { unit: mode === 'unit', plan: mode === 'plan' };
}
