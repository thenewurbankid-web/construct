// #224 — thin glue between the core change tracker (src/file-change-tracker.mjs),
// the core diff view model (src/text-diff.mjs) and the Pages Editor routes.
// Path scoping stays in pagesEditor.mjs's resolvePageFile (callers pass the
// already-validated absPath/relPath); this module never resolves paths itself.
import fs from 'node:fs';
import { createChangeTracker } from '../../../packages/core/file-change-tracker.mjs';
import { buildDiffView } from '../../../packages/core/text-diff.mjs';

export const pageChangeTracker = createChangeTracker();

/** Observe the file's current disk content and describe its last external
 * change (or null). The change is per-file and persists until dismissed or
 * until the editor itself saves the file. */
export function describePageChange(absPath, relPath, tracker = pageChangeTracker) {
  tracker.observe(relPath, fs.readFileSync(absPath, 'utf8'));
  const change = tracker.getLastChange(relPath);
  if (!change) return { change: null };
  const { rows, stats } = buildDiffView(change.before, change.after);
  return {
    change: { at: change.at, beforeHash: change.beforeHash, afterHash: change.afterHash, stats, rows },
  };
}

/** Called by the editor's own save path so its writes are never reported as external. */
export function adoptOwnWrite(relPath, content, tracker = pageChangeTracker) {
  tracker.adopt(relPath, content);
}
