/**
 * Interim content of the Git screen's "Changes" tab (#374, shell only). The real stage/unstage,
 * diff and commit-box content is #331/#710 (`docs/design/git-panel.md`), not built here — this is
 * the extension point that follow-up build replaces. Read-only, honest about what is and is not
 * here yet, and points at the one place today's changed-file view already exists (the PRs tab,
 * once a branch/change is open).
 */
export function GitChangesPlaceholder() {
  return (
    <div className="dg-empty" data-testid="git-changes-placeholder">
      <p className="dg-empty-title">Stage, diff and commit are coming here</p>
      <p className="hint">
        This tab will hold the changed-file tree with stage/unstage checkboxes, the file diff and the commit
        box (issue #331, design in <code>docs/design/git-panel.md</code>). For now, open the <strong>PRs</strong>{' '}
        tab to see today&apos;s changed-file view for a branch, and the <strong>Commit</strong> tab for the
        commit-on-save settings.
      </p>
    </div>
  );
}
