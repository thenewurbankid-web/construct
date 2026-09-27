import type { ShellTab } from '@/features/shell';
import { AutoCommitSettingsController, CommitIndicatorController } from '@/features/git-session';
import { BadgeLegend } from '../components/BadgeLegend';
import { BlastRadius } from '../components/BlastRadius';
import { ChangeTree } from '../components/ChangeTree';
import { FindingDetail } from '../components/FindingDetail';
import { FindingsPanel } from '../components/FindingsPanel';
import { FindingsSummary } from '../components/FindingsSummary';
import { GitChangesPlaceholder } from '../components/GitChangesPlaceholder';
import { GitCommitsPlaceholder } from '../components/GitCommitsPlaceholder';
import { IndicatorCards } from '../components/IndicatorCards';
import { ReviewSources } from '../components/ReviewSources';
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

// Presentation-only: Review's pieces as shell tabs. The controllers register these into the shell's slot
// registry while a Review/Git screen is mounted (Browser: source, PRs list or changed units; Tools: badge
// legend or the five indicators, findings, finding detail, plan match and commit settings; Drawer: the
// findings summary).
//
// #374 (Git screen shell): every tab added for the new shell is deliberately NOT `preferred`, so it can
// never change which tab an existing route shows by default -- the pre-#374 tabs (`review-sources`,
// `review-units`, `review-health`, `review-findings`, `review-legend`) keep their ids, titles and
// `preferred` flags exactly as before. This is what lets the Git screen's tab strip (Changes | Branches |
// PRs | Commits, and Findings | Detail | Plan match | Commit) be built additively, with no existing
// review e2e spec needing to change.

/** The "Changes" browser tab (#374, both routes): interim placeholder, see GitChangesPlaceholder. */
export function gitChangesTab(): ShellTab {
  return { id: 'git-changes', title: 'Changes', render: () => <GitChangesPlaceholder /> };
}

/** The "Commits" browser tab (#374, both routes): interim placeholder, see GitCommitsPlaceholder. */
export function gitCommitsTab(): ShellTab {
  return { id: 'git-commits', title: 'Commits', render: () => <GitCommitsPlaceholder /> };
}

/** The "Commit" tools tab (#374, both routes): today's commit-on-save settings and indicator,
 * relocated here from the Settings screen per `ia-five-screens.md`'s own decision -- not rebuilt. */
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

export function listShellTabs(sources: ReviewSourcesProps | null, glossary: GlossaryEntry[]): { browser: ShellTab; tools: ShellTab } {
  return {
    browser: { id: 'review-sources', title: 'Branches', preferred: true, badge: sources ? sources.count : null, render: () => (sources ? <ReviewSources {...sources} /> : <p className="hint rv-pad">Reading branches...</p>) },
    tools: { id: 'review-legend', title: 'What the badges mean', preferred: true, render: () => <BadgeLegend entries={glossary} /> },
  };
}

export type ChangeTabsInput = {
  tree: ChangeTreeProps | null;
  cards: IndicatorCard[] | null;
  findings: FindingsPanelProps | null;
  summary: FindingsSummaryProps | null;
  detail: FindingDetailView | null;
  onCloseDetail: () => void;
  scope: BlastRadiusProps | null;
};

export function changeShellTabs({ tree, cards, findings, summary, detail, onCloseDetail, scope }: ChangeTabsInput): {
  browser: ShellTab;
  tools: ShellTab;
  findings: ShellTab;
  detail: ShellTab;
  planMatch: ShellTab;
  drawer: ShellTab;
} {
  const count = findings ? findings.view.total : null;
  return {
    browser: { id: 'review-units', title: 'Changed units', preferred: true, render: () => (tree ? <ChangeTree {...tree} /> : <p className="hint rv-pad">Analysing this change...</p>) },
    tools: { id: 'review-health', title: 'Health', preferred: true, render: () => (cards ? <IndicatorCards cards={cards} /> : <p className="hint rv-pad">The indicators appear when the analysis finishes.</p>) },
    findings: { id: 'review-findings', title: 'Findings', badge: count, render: () => (findings ? <FindingsPanel {...findings} /> : <p className="hint rv-pad">Findings appear when the analysis finishes.</p>) },
    // #374: "Detail" and "Plan match" tabs, additive -- the same view models already shown inline in
    // the center stage (unchanged, so review-findings.spec.js's existing multi-step finding-detail
    // and plan-picker flows need no edits), now also reachable as their own Tools tab per the mock.
    detail: {
      id: 'git-detail',
      title: 'Detail',
      render: () => (detail ? <FindingDetail detail={detail} onClose={onCloseDetail} /> : <p className="hint rv-pad" data-testid="git-detail-empty">Select a finding in the Findings tab to see its detail here.</p>),
    },
    planMatch: {
      id: 'git-plan-match',
      title: 'Plan match',
      render: () => (scope ? <BlastRadius {...scope} /> : <p className="hint rv-pad" data-testid="git-plan-match-empty">Plan match appears when the analysis finishes.</p>),
    },
    drawer: { id: 'review-findings-summary', title: 'Findings', badge: count, render: () => (summary ? <FindingsSummary {...summary} /> : <p className="hint rv-pad">Findings appear when the analysis finishes.</p>) },
  };
}
