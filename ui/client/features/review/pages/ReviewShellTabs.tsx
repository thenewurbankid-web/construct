import type { ShellTab } from '@/features/shell';
import { BadgeLegend } from '../components/BadgeLegend';
import { ChangeTree } from '../components/ChangeTree';
import { FindingsPanel } from '../components/FindingsPanel';
import { FindingsSummary } from '../components/FindingsSummary';
import { IndicatorCards } from '../components/IndicatorCards';
import { ReviewSources } from '../components/ReviewSources';
import type { ChangeTreeProps, FindingsPanelProps, FindingsSummaryProps, GlossaryEntry, IndicatorCard, ReviewSourcesProps } from '../types';

// Presentation-only: Review's pieces as shell tabs. The controllers register these into the shell's slot
// registry while a Review screen is mounted (Browser: source or changed units; Tools: badge legend, or the
// five indicators and the findings; Drawer: the findings summary).
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
};

export function changeShellTabs({ tree, cards, findings, summary }: ChangeTabsInput): { browser: ShellTab; tools: ShellTab; findings: ShellTab; drawer: ShellTab } {
  const count = findings ? findings.view.total : null;
  return {
    browser: { id: 'review-units', title: 'Changed units', preferred: true, render: () => (tree ? <ChangeTree {...tree} /> : <p className="hint rv-pad">Analysing this change...</p>) },
    tools: { id: 'review-health', title: 'Health', preferred: true, render: () => (cards ? <IndicatorCards cards={cards} /> : <p className="hint rv-pad">The indicators appear when the analysis finishes.</p>) },
    findings: { id: 'review-findings', title: 'Findings', badge: count, render: () => (findings ? <FindingsPanel {...findings} /> : <p className="hint rv-pad">Findings appear when the analysis finishes.</p>) },
    drawer: { id: 'review-findings-summary', title: 'Findings', badge: count, render: () => (summary ? <FindingsSummary {...summary} /> : <p className="hint rv-pad">Findings appear when the analysis finishes.</p>) },
  };
}
