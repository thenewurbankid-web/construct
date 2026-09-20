import type { ShellTab } from '@/features/shell';
import { BadgeLegend } from '../components/BadgeLegend';
import { ChangeTree } from '../components/ChangeTree';
import { IndicatorCards } from '../components/IndicatorCards';
import { ReviewSources } from '../components/ReviewSources';
import type { ChangeTreeProps, GlossaryEntry, IndicatorCard, ReviewSourcesProps } from '../types';

// Presentation-only: Review's pieces as shell tabs. The controllers register these into the shell's slot
// registry while a Review screen is mounted (Browser: source or changed units; Tools: badge legend or
// the five indicators).
export function listShellTabs(sources: ReviewSourcesProps | null, glossary: GlossaryEntry[]): { browser: ShellTab; tools: ShellTab } {
  return {
    browser: { id: 'review-sources', title: 'Branches', preferred: true, badge: sources ? sources.count : null, render: () => (sources ? <ReviewSources {...sources} /> : <p className="hint rv-pad">Reading branches...</p>) },
    tools: { id: 'review-legend', title: 'What the badges mean', preferred: true, render: () => <BadgeLegend entries={glossary} /> },
  };
}

export function changeShellTabs(tree: ChangeTreeProps | null, cards: IndicatorCard[] | null, findingCount: number | null): { browser: ShellTab; tools: ShellTab } {
  return {
    browser: { id: 'review-units', title: 'Changed units', preferred: true, render: () => (tree ? <ChangeTree {...tree} /> : <p className="hint rv-pad">Analysing this change...</p>) },
    tools: { id: 'review-health', title: 'Health', preferred: true, badge: findingCount, render: () => (cards ? <IndicatorCards cards={cards} /> : <p className="hint rv-pad">The indicators appear when the analysis finishes.</p>) },
  };
}
