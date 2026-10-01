// Inspector/tree "Git changed-vs-main" signal (#829, design 8.2's Git row): whether the open page
// file differs from `main` -- the same read-only block prHealth already uses for a PR-style diff
// (packages/engine/gitTrees.mjs), plus ui/server/src/git.mjs's working-tree status for an edit not
// committed yet. Never a second git implementation, never fails the request -- like componentUsedBy
// and pageImpact, this is a bonus signal, not load-bearing.
import { mergeBase, changedFiles, resolveCommit } from '../../../packages/engine/gitTrees.mjs';
import { status as workingTreeStatus } from './git.mjs';
import { resolvePageFile } from '../../../packages/engine/pagesEditor.mjs';

export function pageChangedVsMain(root, feature, file, { base = 'main' } = {}) {
  const { relPath } = resolvePageFile(root, feature, file);
  const notChanged = { ok: true, path: relPath, changed: false };

  // resolveCommit (git rev-parse under the hood) is the "is this even a usable repo" check: unlike
  // ui/server/src/git.mjs's own isRepo(), it never compares resolved paths, so it isn't tripped up
  // by a caller-supplied root that is itself a symlink (e.g. macOS's /var -> /private/var tmpdir).
  const headRef = resolveCommit(root, 'head', 'HEAD');
  if (!headRef.ok) return notChanged; // not a repo, or no commits yet

  try {
    if (workingTreeStatus(root).some((f) => f.path === relPath)) return { ok: true, path: relPath, changed: true };
  } catch {
    return notChanged;
  }

  const baseRef = resolveCommit(root, 'base', base);
  if (!baseRef.ok) return notChanged;
  const mb = mergeBase(root, baseRef.sha, headRef.sha);
  if (!mb) return notChanged;
  const diff = changedFiles(root, mb, headRef.sha);
  if (!diff.ok) return notChanged;
  return { ok: true, path: relPath, changed: diff.files.some((f) => f.path === relPath) };
}
