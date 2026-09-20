// Pure (DOMAIN-001): turn a finished analysis into the badges the list shows. Every badge is TEXT (never
// colour alone), and a branch with nothing found gets a positive "Nothing found" badge rather than an
// empty cell. "No plan" is neutral, never an error.
import type { AnalysisDone, Badge, BranchRow, IndicatorSlim } from '../types.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function badgeFor(i: IndicatorSlim, analysis: AnalysisDone): Badge | null {
  switch (i.id) {
    case 'blast-radius':
      if (!i.measured) return { id: i.id, text: 'No plan', tone: 'neutral' };
      if (i.status === 'clear') return { id: i.id, text: 'Scope as planned', tone: 'ok' };
      return { id: i.id, text: analysis.scope ? `Scope ${analysis.scope.declared} → ${analysis.scope.touched}` : 'Scope changed', tone: i.status === 'attention' ? 'danger' : 'info' };
    case 'rule-regressions':
      return i.status === 'clear' ? null : { id: i.id, text: plural(i.findings, 'rule regression'), tone: 'danger' };
    case 'unexplained':
      return !i.measured || i.status === 'clear' ? null : { id: i.id, text: `${i.findings} unexplained`, tone: 'warn' };
    case 'public-surface':
      return i.status === 'clear' ? null : { id: i.id, text: 'Public API', tone: 'warn' };
    case 'flow-diff':
      return i.status === 'clear' ? null : { id: i.id, text: 'Flow changed', tone: i.status === 'attention' ? 'warn' : 'info' };
    default:
      return null;
  }
}

/** The badges of one branch, or a single positive one when nothing was found. */
export function badgesOf(analysis: AnalysisDone): Badge[] {
  const found = analysis.indicators.flatMap((i) => badgeFor(i, analysis) ?? []);
  const problems = found.filter((b) => b.tone !== 'neutral' && b.tone !== 'ok');
  return problems.length === 0 ? [...found, { id: 'nothing-found', text: 'Nothing found', tone: 'ok' }] : found;
}

/** The single word for a row that has no badges yet. */
export function pendingText(state: BranchRow['analysis']['state']): string | null {
  if (state === 'queued') return 'Queued';
  if (state === 'running' || state === 'none') return 'Analysing…';
  return null;
}
