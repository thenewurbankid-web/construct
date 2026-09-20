// Pure (DOMAIN-001): the actions the Features stage offers, one per command form of the retired Dashboard
// (owner decision 2026-09-20: the Dashboard is gone, Create / Refactor / Import become stage actions).
export type StageActionId = 'create' | 'refactor' | 'research' | 'import';

export type StageAction = { id: StageActionId; label: string; hint: string };

export const STAGE_ACTIONS: StageAction[] = [
  { id: 'create', label: 'Create', hint: 'Scaffold a feature, a slice or a single layer file' },
  { id: 'refactor', label: 'Refactor', hint: 'Move a unit to another layer or rename it' },
  { id: 'research', label: 'Research', hint: 'Doctor, summarize a feature and the other read-only checks' },
  { id: 'import', label: 'Import', hint: 'Bring one old file, or an approved plan, into the architecture' },
];

/** Choosing the open action again closes it; choosing another switches to it. */
export function nextOpenAction(current: StageActionId | null, chosen: StageActionId): StageActionId | null {
  return current === chosen ? null : chosen;
}
