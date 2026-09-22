// Pure planning logic for the project-board hygiene sync. No I/O here so it can
// be unit-tested with plain objects (see plan.test.mjs).
//
// Inputs
//   issues: [{ number, id, state: 'OPEN'|'CLOSED', closedAt: ISO|null }]   (issues only, never PRs)
//   items:  [{ itemId, number, status: string|null, isArchived: bool, module, kind, priority }]
//   now:    Date
// Output: { add, setStatus, setArea, archive, report }
// Area is derived from Module + Sub-module (see taxonomy.mjs) and auto-corrected; other
// classification gaps are report-only.

import { checkArea, areaOf, TAXONOMY } from './taxonomy.mjs';

export const STATUS = { BACKLOG: 'Backlog', IN_PROGRESS: 'In progress', DONE: 'Done' };
export const DEFAULT_ARCHIVE_DAYS = 14;

export function statusForState(state) {
  return state === 'CLOSED' ? STATUS.DONE : STATUS.BACKLOG;
}

export function isOlderThan(closedAt, days, now) {
  if (!closedAt) return false;
  return now.getTime() - new Date(closedAt).getTime() > days * 24 * 60 * 60 * 1000;
}

export function planActions({ issues, items, now = new Date(), archiveDays = DEFAULT_ARCHIVE_DAYS }) {
  const byNumber = new Map(items.filter(i => !i.isArchived).map(i => [i.number, i]));
  const archivedNumbers = new Set(items.filter(i => i.isArchived).map(i => i.number));
  const add = [];
  const setStatus = [];
  const archive = [];
  const setArea = [];
  const areaProblems = [];

  for (const issue of issues) {
    const item = byNumber.get(issue.number);
    if (!item) {
      // Archived items are deliberately off the board: do not re-add them.
      if (archivedNumbers.has(issue.number)) continue;
      add.push({ number: issue.number, contentId: issue.id, status: statusForState(issue.state) });
      continue;
    }
    if (issue.state === 'CLOSED' && item.status !== STATUS.DONE) {
      setStatus.push({ itemId: item.itemId, number: issue.number, from: item.status, status: STATUS.DONE });
    } else if (issue.state === 'OPEN' && item.status === STATUS.DONE) {
      setStatus.push({ itemId: item.itemId, number: issue.number, from: item.status, status: STATUS.IN_PROGRESS });
    } else if (issue.state === 'CLOSED' && item.status === STATUS.DONE && isOlderThan(issue.closedAt, archiveDays, now)) {
      archive.push({ itemId: item.itemId, number: issue.number });
    }
  }

  for (const item of items.filter(i => !i.isArchived)) {
    const problem = checkArea(item);
    if (!problem) continue;
    if (TAXONOMY[item.module]?.includes(item.subModule)) {
      setArea.push({ itemId: item.itemId, number: item.number, from: item.area ?? null, area: areaOf(item.module, item.subModule) });
    } else {
      areaProblems.push(`#${item.number}: ${problem}`);
    }
  }

  // Report-only findings (a human/agent decides these; the sync never guesses).
  const openNumbers = new Set(issues.filter(i => i.state === 'OPEN').map(i => i.number));
  const report = {
    missingModule: items.filter(i => !i.isArchived && !i.module).map(i => i.number),
    missingSubModule: items.filter(i => !i.isArchived && i.module && !i.subModule).map(i => i.number),
    areaProblems,
    missingKind: items.filter(i => !i.isArchived && !i.kind).map(i => i.number),
    openWithoutPriority: items
      .filter(i => !i.isArchived && openNumbers.has(i.number) && !i.priority && i.kind !== 'Standing')
      .map(i => i.number),
  };
  return { add, setStatus, setArea, archive, report };
}
