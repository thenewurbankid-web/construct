import type { ShellTab } from '@/features/shell';
import { AutoCommitSettingsController, CommitIndicatorController } from '@/features/git-session';
import { BadgeLegend } from '../components/BadgeLegend';
import { BlastRadius } from '../components/BlastRadius';
import { ChangeTree } from '../components/ChangeTree';
import { FindingDetail } from '../components/FindingDetail';
import { FindingsPanel } from '../components/FindingsPanel';
import { FindingsSummary } from '../components/FindingsSummary';
import { IndicatorCards } from '../components/IndicatorCards';
import type { ReviewListPageProps } from './ReviewListPage';
import { ReviewSources } from '../components/ReviewSources';
import { GitConnectEmptyState } from './ReviewListPage';
import type {
  BlastRadiusProps,
  ChangeTreeProps,
  FindingDetailView,
  FindingsPanelProps,
  FindingsSummaryProps,
  GlossaryEntry,
  IndicatorCard,
  ReviewSourcesProps,
} from '../types';

// Presentation-only: the Git screen's left tabs (Changes | Branches | PRs | Commits) and right tabs
// (Findings | Detail | Plan match | Commit), built here so the two controllers below (browsing the
// list, and reading one change) stay in charge of their own state while contributing to the same
// shell tab strips (`docs/design/ia-five-screens.md` section 7, #374). Review is a verb inside Git:
// there is no separate Review route or mode any more.

/** The Commit tab, right panel: today's commit-on-save settings and indicator (#283), relocated here
 * per the owner decision in `ia-five-screens.md` -- git settings belong to Git, not Settings. Staging,
 * the commit box and push/pull are #331's job; this is the shell-placement slice. */
export function gitCommitTab(): ShellTab {
  return {
    id: 'git-commit',
    title: 'Commit',
    render: () => (
      <div className="rv-pad">
        <AutoCommitSettingsController />
        <CommitIndicatorController />
      </div>
    ),
  };
}

/** The Commits tab, left panel: commit history. Not built yet -- #331 designs the Changes/Branches/
 * Commit tab contents; this shell only reserves its place. */
export function gitCommitsTab(): ShellTab {
  return {
    id: 'git-commits',
    title: 'Commits',
    render: () => <p className="hint rv-pad">Commit history is not built yet. See #331.</p>,
  };
}

export type ListBrowserTabsInput = { sources: ReviewSourcesProps | null; list: ReviewListPageProps; hasRemote: boolean | null };

/** Left tabs while browsing the list: Changes has nothing to show yet (no PR open), Branches is the
 * source/base picker (today's default, matching the ranked list the center pane already shows), PRs
 * is real pull-request data -- not built yet, same reserved treatment as Commits (#330 builds the
 * remote/PR connection; this shell only reserves its place). With no remote configured, PRs shows the
 * "Connect remote" / "Clone a repository" empty state (`ia-git-connect`, #374) instead of the #330 note --
 * the local branch list itself never needs a remote, so it stays the center pane's job
 * (`ReviewListController`'s own return value) so it isn't rendered twice. */
export function listBrowserTabs({ sources, list, hasRemote }: ListBrowserTabsInput): { changes: ShellTab; branches: ShellTab; prs: ShellTab; commits: ShellTab } {
  return {
    changes: { id: 'git-changes-list', title: 'Changes', render: () => <p className="hint rv-pad">Open a PR or branch to see its changed files.</p> },
    branches: {
      id: 'review-sources',
      title: 'Branches',
      preferred: true,
      badge: list.list ? list.list.rows.length : null,
      render: () => (sources ? <ReviewSources {...sources} /> : <p className="hint rv-pad">Reading branches...</p>),
    },
    prs: {
      id: 'review-list-tab',
      title: 'PRs',
      render: () => (hasRemote === false ? <GitConnectEmptyState /> : <p className="hint rv-pad">Pull-request data is not connected yet. See #330.</p>),
    },
    commits: gitCommitsTab(),
  };
}

/** Right tabs while browsing the list: only the badge legend and the Commit tab apply; Findings,
 * Detail and Plan match need one open change. */
export function listToolsTabs(glossary: GlossaryEntry[]): { legend: ShellTab; commit: ShellTab } {
  return {
    legend: { id: 'review-legend', title: 'Findings', preferred: true, render: () => <BadgeLegend entries={glossary} /> },
    commit: gitCommitTab(),
  };
}

export type ChangeBrowserTabsInput = { tree: ChangeTreeProps | null; onBack: () => void };

/** Left tabs while reading one change: Changes is the changed-file tree (#331 fills in staging later);
 * Branches and PRs point back to the list, since browsing another branch means leaving this change. */
export function changeBrowserTabs({ tree, onBack }: ChangeBrowserTabsInput): { changes: ShellTab; branches: ShellTab; prs: ShellTab; commits: ShellTab } {
  const backHint = (what: string) => (
    <div className="rv-pad">
      <p className="hint">Go back to the list to browse {what}.</p>
      <button type="button" className="dg-btn" onClick={onBack}>Back to the list</button>
    </div>
  );
  return {
    changes: { id: 'review-units', title: 'Changes', preferred: true, render: () => (tree ? <ChangeTree {...tree} /> : <p className="hint rv-pad">Analysing this change...</p>) },
    branches: { id: 'review-branches-hint', title: 'Branches', render: () => backHint('branches') },
    prs: { id: 'review-prs-hint', title: 'PRs', render: () => backHint('other PRs') },
    commits: gitCommitsTab(),
  };
}

export type ChangeToolsTabsInput = {
  cards: IndicatorCard[] | null;
  findings: FindingsPanelProps | null;
  detail: FindingDetailView | null;
  onCloseFinding: () => void;
  scope: BlastRadiusProps | null;
};

/** Right tabs while reading one change: Health is the five indicators (today's default), Findings is
 * the findings panel, Detail is the selected finding (moved out of the stage, #374's re-slot), Plan
 * match is the same declared-vs-actual comparison the stage also shows (kept on the stage too, per
 * "center change view + blast radius" -- this tab is a second, always-reachable place for it, useful
 * from the narrow layout and while the right panel is what's open), Commit is today's settings. */
export function changeToolsTabs({ cards, findings, detail, onCloseFinding, scope }: ChangeToolsTabsInput): {
  health: ShellTab;
  findings: ShellTab;
  detail: ShellTab;
  planMatch: ShellTab;
  commit: ShellTab;
} {
  const count = findings ? findings.view.total : null;
  return {
    health: { id: 'review-health', title: 'Health', preferred: true, render: () => (cards ? <IndicatorCards cards={cards} /> : <p className="hint rv-pad">The indicators appear when the analysis finishes.</p>) },
    findings: { id: 'review-findings', title: 'Findings', badge: count, render: () => (findings ? <FindingsPanel {...findings} /> : <p className="hint rv-pad">Findings appear when the analysis finishes.</p>) },
    detail: { id: 'review-detail', title: 'Detail', render: () => (detail ? <FindingDetail detail={detail} onClose={onCloseFinding} /> : <p className="hint rv-pad">Select a finding in Findings to see its detail here.</p>) },
    planMatch: { id: 'review-plan-match', title: 'Plan match', render: () => (scope ? <BlastRadius {...scope} /> : <p className="hint rv-pad">Plan match appears when the analysis finishes.</p>) },
    commit: gitCommitTab(),
  };
}

export type ChangeDrawerTabsInput = { summary: FindingsSummaryProps | null; count: number | null };

export function changeDrawerTabs({ summary, count }: ChangeDrawerTabsInput): { drawer: ShellTab } {
  return { drawer: { id: 'review-findings-summary', title: 'Findings', badge: count, render: () => (summary ? <FindingsSummary {...summary} /> : <p className="hint rv-pad">Findings appear when the analysis finishes.</p>) } };
}
