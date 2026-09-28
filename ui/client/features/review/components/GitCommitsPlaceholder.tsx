/**
 * Interim content of the Git screen's "Commits" tab (#374, shell only). A read-only commit-history
 * list has no building block in `ui/server/src/git.mjs` yet (only `headSha`/`currentBranch`); adding
 * one is not required by #374's acceptance and is left for a follow-up rather than built here.
 */
export function GitCommitsPlaceholder() {
  return (
    <div className="dg-empty" data-testid="git-commits-placeholder">
      <p className="dg-empty-title">Commit history is not built yet</p>
      <p className="hint">
        This tab will list this branch&apos;s commits. Today&apos;s auto-commit activity and settings are on the{' '}
        <strong>Commit</strong> tab.
      </p>
    </div>
  );
}
